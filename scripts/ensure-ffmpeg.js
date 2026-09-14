#!/usr/bin/env node
// postinstall hook: makes sure ./bin/ffmpeg exists and is executable.
//
// yt-dlp needs ffmpeg to mux separate DASH video+audio streams into a single
// file — this is the *only* way to get a video for many Instagram/Facebook
// posts that don't expose a progressive (already-muxed) format. Without it,
// yt-dlp silently drops those entries and extraction fails with something
// like "No downloadable media was found at that URL", even though metadata
// probing succeeds fine.
//
// Skips silently (with a warning) on unsupported platforms/architectures or
// when an FFMPEG_PATH override is already configured — the app will fall
// back to a `ffmpeg` found on PATH in that case (matches yt-dlp's own
// ffmpeg auto-detection).
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const binDir = path.join(projectRoot, "bin");
const dest = path.join(binDir, "ffmpeg");

const ARCH_URLS = {
  x64: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",
  arm64: "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz",
};

function alreadyWorking() {
  if (!fs.existsSync(dest)) return false;
  try {
    fs.accessSync(dest, fs.constants.X_OK);
  } catch {
    return false;
  }
  const result = spawnSync(dest, ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

/**
 * Extracts a .tar.xz archive into destDir. Prefers the system `tar` (which
 * on most distros can decompress xz natively via liblzma), but some minimal
 * shared hosts ship `tar` without xz support and no standalone `xz`/`unxz`
 * binary either. In that case, fall back to Python's stdlib `lzma` module
 * (present on virtually every Python 3 install) to decompress to a plain
 * .tar first, then let `tar` extract that.
 */
function extractTarXz(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  const direct = spawnSync("tar", ["-xJf", archivePath, "-C", destDir]);
  if (direct.status === 0) return;

  const tmpTar = `${archivePath}.tar`;
  const pyScript =
    "import lzma, shutil, sys\n" +
    "with lzma.open(sys.argv[1]) as fin, open(sys.argv[2], 'wb') as fout:\n" +
    "    shutil.copyfileobj(fin, fout)\n";
  const py = spawnSync("python3", ["-c", pyScript, archivePath, tmpTar]);
  if (py.status !== 0) {
    throw new Error(
      "no working `tar -xJ` and no usable python3 `lzma` fallback to decompress the ffmpeg archive",
    );
  }

  const untar = spawnSync("tar", ["-xf", tmpTar, "-C", destDir]);
  fs.rmSync(tmpTar, { force: true });
  if (untar.status !== 0) {
    throw new Error("failed to extract the decompressed ffmpeg tarball");
  }
}

function findExtractedBinary(destDir) {
  for (const entry of fs.readdirSync(destDir)) {
    const candidate = path.join(destDir, entry, "ffmpeg");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function main() {
  if (process.env.FFMPEG_PATH) {
    console.log(`[slackgram] FFMPEG_PATH is set to "${process.env.FFMPEG_PATH}"; skipping bundled ffmpeg download.`);
    return;
  }

  if (alreadyWorking()) {
    console.log("[slackgram] bin/ffmpeg already present and working.");
    return;
  }

  const url = ARCH_URLS[process.arch];
  if (process.platform !== "linux" || !url) {
    console.warn(
      `[slackgram] Automatic ffmpeg download is only wired up for linux/x64 and linux/arm64 ` +
        `(detected "${process.platform}/${process.arch}"). yt-dlp will fall back to a system ` +
        "ffmpeg on PATH if one is installed; without it, videos that need video+audio muxing " +
        "will fail to download. Install ffmpeg yourself and point FFMPEG_PATH at it if needed.",
    );
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slackgram-ffmpeg-"));
  const archivePath = path.join(tmpDir, "ffmpeg.tar.xz");

  console.log(`[slackgram] Downloading ffmpeg (static, ${process.arch}) from ${url} ...`);
  try {
    const curl = spawnSync("curl", ["-sL", "-o", archivePath, url], { stdio: "inherit" });
    if (curl.status !== 0) throw new Error(`curl exited with code ${curl.status}`);

    extractTarXz(archivePath, tmpDir);

    const extracted = findExtractedBinary(tmpDir);
    if (!extracted) throw new Error("could not locate an ffmpeg binary inside the downloaded archive");

    fs.copyFileSync(extracted, dest);
    fs.chmodSync(dest, 0o755);

    const check = spawnSync(dest, ["-version"], { stdio: "inherit" });
    if (check.status !== 0) throw new Error("downloaded ffmpeg binary failed to run (`ffmpeg -version`)");

    console.log(`[slackgram] ffmpeg installed at ${dest}`);
  } catch (err) {
    console.warn(
      `[slackgram] Failed to download ffmpeg automatically (${err.message}). ` +
        "Run `npm run setup:ffmpeg` manually, or set FFMPEG_PATH to an existing install. " +
        "Without ffmpeg, some videos (ones without a progressive format) will fail to download.",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
