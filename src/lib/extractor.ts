import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import mime from "mime-types";
import { config } from "../config";
import { detectPlatform } from "./url";
import { runYtDlp } from "./ytdlp";
import {
  DownloadError,
  type DownloadOptions,
  type ExtractionResult,
  type MediaItem,
  type Platform,
} from "./types";

/** Shape of a single entry in yt-dlp's `-J` (dump-single-json) output that we care about. */
interface YtDlpDownload {
  filepath?: string | null;
  _filename?: string | null;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

interface YtDlpFormat {
  url?: string | null;
  vcodec?: string | null;
  acodec?: string | null;
}

interface YtDlpThumbnail {
  url: string;
  width?: number | null;
  height?: number | null;
  id?: string;
}

interface YtDlpJson {
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  uploader_url?: string;
  webpage_url?: string;
  _type?: string;
  entries?: YtDlpJson[];
  playlist_index?: number | null;
  requested_downloads?: YtDlpDownload[];
  /**
   * Video formats available for this entry. Instagram/Facebook photo posts
   * (and image slides within a carousel) report an empty array here — the
   * actual full-resolution photo only lives in `thumbnails` (see below).
   */
  formats?: YtDlpFormat[];
  ext?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filepath?: string | null;
  _filename?: string | null;
  thumbnails?: YtDlpThumbnail[];
}

async function makeWorkDir(): Promise<string> {
  const id = crypto.randomBytes(8).toString("hex");
  const dir = path.join(config.tmpDir, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function classifyKind(entry: YtDlpDownload | YtDlpJson): MediaItem["kind"] {
  const vcodec = entry.vcodec;
  const acodec = entry.acodec;
  if (vcodec && vcodec !== "none") return "video";
  if (acodec && acodec !== "none" && (!vcodec || vcodec === "none")) return "audio";
  const ext = (entry.ext ?? "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv"].includes(ext)) return "video";
  if (["mp3", "m4a", "aac", "wav"].includes(ext)) return "audio";
  return "image";
}

/** True when this yt-dlp entry has at least one format with an actual video track. */
function entryHasVideo(entry: YtDlpJson): boolean {
  return (entry.formats ?? []).some(
    (f) => f.url && f.vcodec && f.vcodec !== "none",
  );
}

/**
 * Picks the best (highest-resolution) thumbnail for a still-image post.
 * Instagram's "original" rendition is the one whose CDN URL has no explicit
 * resize marker (`stp=..._s<W>x<H>`); every downsized variant has one. We
 * prefer that; failing to find it, we fall back to whichever variant
 * advertises the largest `_s<W>x<H>` dimensions in its URL.
 */
function pickBestThumbnail(thumbnails: YtDlpThumbnail[] | undefined): YtDlpThumbnail | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined;

  const withDims = thumbnails.filter((t) => t.width && t.height);
  if (withDims.length > 0) {
    return [...withDims].sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!))[0];
  }

  const original = thumbnails.find((t) => !/_s\d+x\d+/.test(t.url));
  if (original) return original;

  let best: { thumb: YtDlpThumbnail; area: number } | undefined;
  for (const t of thumbnails) {
    const m = /_s(\d+)x(\d+)/.exec(t.url);
    if (!m) continue;
    const area = Number(m[1]) * Number(m[2]);
    if (!best || area > best.area) best = { thumb: t, area };
  }
  return best?.thumb ?? thumbnails[0];
}

/**
 * yt-dlp's default format selection picks the highest-bitrate stream, which
 * for Facebook is often an AV1 DASH stream. Many players/browsers lack AV1
 * decode support and render such videos as a black frame (audio still
 * plays), so we prefer Facebook's H.264 progressive `hd`/`sd` formats, and
 * otherwise avoid AV1 entirely when an alternative codec is available.
 */
const VIDEO_FORMAT_SELECTOR = "hd/sd/bv*[vcodec!*=av01]+ba/b[vcodec!*=av01]/best";

function buildFileName(playlistIndex: number | null | undefined, id: string | undefined, ext: string): string {
  const base = id ?? "media";
  return playlistIndex != null ? `${playlistIndex}-${base}.${ext}` : `${base}.${ext}`;
}

/** Downloads a still image directly (used for Instagram/Facebook photo posts/slides). */
async function downloadImageEntry(entry: YtDlpJson, workDir: string): Promise<MediaItem | undefined> {
  const thumb = pickBestThumbnail(entry.thumbnails);
  if (!thumb) return undefined;

  const response = await fetch(thumb.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://www.instagram.com/",
    },
  });
  if (!response.ok) return undefined;

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const ext = mime.extension(contentType) || "jpg";
  const fileName = buildFileName(entry.playlist_index, entry.id, ext);
  const filePath = path.join(workDir, fileName);
  await fs.writeFile(filePath, buffer);

  return {
    kind: "image",
    filePath,
    fileName,
    mimeType: contentType,
    sizeBytes: buffer.length,
    width: thumb.width ?? undefined,
    height: thumb.height ?? undefined,
  };
}

async function toMediaItem(download: YtDlpDownload, fallback: YtDlpJson): Promise<MediaItem | undefined> {
  const filePath = download.filepath ?? download._filename ?? fallback.filepath ?? fallback._filename;
  if (!filePath) return undefined;

  let stat: { size: number };
  try {
    stat = await fs.stat(filePath);
  } catch {
    return undefined;
  }

  const kind = classifyKind({ ...fallback, ...download });
  const ext = path.extname(filePath).slice(1) || download.ext || fallback.ext || "bin";
  const mimeType = mime.lookup(ext) || "application/octet-stream";

  return {
    kind,
    filePath,
    fileName: path.basename(filePath),
    mimeType,
    sizeBytes: stat.size,
    width: download.width ?? fallback.width ?? undefined,
    height: download.height ?? fallback.height ?? undefined,
    durationSeconds: download.duration ?? fallback.duration ?? undefined,
  };
}

function parseEntries(stdout: string): YtDlpJson[] {
  const parsed: YtDlpJson = JSON.parse(extractLastJsonLine(stdout));
  return parsed._type === "playlist" && parsed.entries ? parsed.entries : [parsed];
}

/**
 * Extracts and downloads all media from a supported Instagram/Facebook URL.
 *
 * Posts can contain videos, still images, or (for carousels) a mix of both.
 * yt-dlp's extractors are video-first and hard-fail on image-only entries,
 * so we first probe metadata in simulate mode (which tolerates image-only
 * posts via `--ignore-no-formats-error`), then:
 *  - download video entries through a second yt-dlp invocation (it handles
 *    DASH video+audio muxing via ffmpeg), and
 *  - download image entries ourselves directly from their best-resolution
 *    thumbnail URL.
 *
 * Returns downloaded file paths under a freshly created temp directory; the
 * caller owns cleanup of that directory (see `cleanupWorkDir`).
 */
export async function extractMedia(
  rawUrl: string,
  options: DownloadOptions = {},
): Promise<ExtractionResult> {
  const { platform } = detectPlatform(rawUrl);
  const workDir = await makeWorkDir();
  const cookiesFile = options.cookiesFile ?? config.defaultCookiesFile;
  const timeoutMs = options.timeoutMs ?? config.processTimeoutMs;

  let metadataEntries: YtDlpJson[];
  let topLevel: { id?: string; title?: string; description?: string; uploader?: string; uploader_url?: string };
  try {
    const probe = await runYtDlp({
      url: rawUrl,
      cookiesFile,
      timeoutMs,
      args: ["--ignore-no-formats-error", "--dump-single-json", "--yes-playlist"],
    });
    const parsedTop: YtDlpJson = JSON.parse(extractLastJsonLine(probe.stdout));
    topLevel = parsedTop;
    metadataEntries = parsedTop._type === "playlist" && parsedTop.entries ? parsedTop.entries : [parsedTop];
  } catch (err) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw err;
  }

  const videoIndices: number[] = [];
  for (const entry of metadataEntries) {
    if (entryHasVideo(entry)) {
      videoIndices.push(entry.playlist_index ?? metadataEntries.indexOf(entry) + 1);
    }
  }

  const items: MediaItem[] = [];

  try {
    if (videoIndices.length > 0) {
      const outputTemplate = path.join(
        workDir,
        "%(playlist_index|)s%(playlist_index&-|)s%(id)s.%(ext)s",
      );
      const args = [
        "--no-simulate",
        "--dump-single-json",
        "--yes-playlist",
        "-f",
        VIDEO_FORMAT_SELECTOR,
        "-o",
        outputTemplate,
      ];
      if (metadataEntries.length > 1) {
        args.push("--playlist-items", videoIndices.join(","));
      }
      const dlResult = await runYtDlp({ url: rawUrl, cookiesFile, timeoutMs, args });
      const dlEntries = parseEntries(dlResult.stdout);

      for (const entry of dlEntries) {
        const downloads = entry.requested_downloads?.length
          ? entry.requested_downloads
          : [
              {
                filepath: entry.filepath,
                _filename: entry._filename,
                ext: entry.ext,
                width: entry.width,
                height: entry.height,
                duration: entry.duration,
                vcodec: entry.vcodec,
                acodec: entry.acodec,
              },
            ];
        for (const download of downloads) {
          const item = await toMediaItem(download, entry);
          if (item) items.push(item);
        }
      }
    }

    for (const entry of metadataEntries) {
      if (entryHasVideo(entry)) continue;
      const item = await downloadImageEntry(entry, workDir);
      if (item) items.push(item);
    }
  } catch (err) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw err;
  }

  if (items.length === 0) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw new DownloadError("No downloadable media was found at that URL", "EXTRACTION_FAILED");
  }

  return {
    metadata: {
      platform,
      sourceUrl: rawUrl,
      id: topLevel.id,
      title: topLevel.title,
      description: topLevel.description,
      uploader: topLevel.uploader,
      uploaderUrl: topLevel.uploader_url,
    },
    items,
    workDir,
  };
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true });
}

/**
 * yt-dlp's `--dump-single-json` prints exactly one JSON line on success, but
 * progress/warning noise can theoretically interleave on stdout depending on
 * postprocessors. Defensively take the last line that looks like a JSON
 * object.
 */
function extractLastJsonLine(stdout: string): string {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }
  throw new Error("No JSON object found in yt-dlp output");
}

export type { Platform };
