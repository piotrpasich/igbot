import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * Central configuration, resolved once at startup from environment
 * variables (loaded via dotenv in the entrypoints) with sane defaults.
 */

const projectRoot = path.resolve(__dirname, "..");

function resolveBundledYtDlp(): string | undefined {
  const candidate = path.join(projectRoot, "bin", "yt-dlp");
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return undefined;
  }
}

function resolveBundledFfmpeg(): string | undefined {
  const candidate = path.join(projectRoot, "bin", "ffmpeg");
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return undefined;
  }
}

export interface AppConfig {
  /** Path (or bare command name) used to invoke yt-dlp. */
  ytDlpPath: string;
  /** Optional path to a Netscape-format cookies file, used by default when none is supplied per-request. */
  defaultCookiesFile?: string;
  /**
   * Optional path to an ffmpeg binary, passed to yt-dlp via
   * `--ffmpeg-location`. yt-dlp needs ffmpeg to mux separate DASH
   * video+audio streams into a single file; many Instagram/Facebook posts
   * only expose separate streams (no progressive/pre-muxed format), so
   * without it those downloads silently fail even though metadata probing
   * succeeds. Falls back to a `ffmpeg` found on PATH (yt-dlp's own default)
   * when unset/not present.
   */
  ffmpegPath?: string;
  /** Directory where temporary per-request download folders are created. */
  tmpDir: string;
  /**
   * Optional TMPDIR override passed to the yt-dlp child process only.
   *
   * The standalone yt-dlp_linux binary is a self-extracting PyInstaller
   * bundle: it unpacks its embedded Python runtime and shared libraries
   * into TMPDIR (the OS default tmp dir, e.g. /tmp) and then mmaps/executes
   * from there. Some shared hosts mount /tmp with `noexec`, which makes
   * that self-extraction fail with errors like "failed to map segment from
   * shared object". Setting YTDLP_TMPDIR to a directory that does allow
   * execution (e.g. somewhere under the app's own home directory) fixes it.
   */
  ytDlpTmpDir?: string;
  /** Max time (ms) allowed for a single yt-dlp invocation before it's killed. */
  processTimeoutMs: number;
  /** HTTP server port. */
  port: number;
  /**
   * Optional URL path prefix the app is mounted under (e.g. "/igbot" when
   * deployed behind Phusion Passenger with PassengerBaseURI set). Passenger's
   * Node integration does not strip this prefix from incoming request
   * paths, so the app has to know about it and route accordingly. Leave
   * unset when running standalone (dev, CLI, or reverse-proxied setups that
   * do strip the prefix themselves).
   */
  basePath: string;
  /** Max number of concurrent extraction/download jobs across the process. */
  maxConcurrentJobs: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config: AppConfig = {
  ytDlpPath: process.env.YTDLP_PATH ?? resolveBundledYtDlp() ?? "yt-dlp",
  defaultCookiesFile: process.env.YTDLP_COOKIES_FILE,
  ffmpegPath: process.env.FFMPEG_PATH ?? resolveBundledFfmpeg(),
  tmpDir: process.env.SLACKGRAM_TMP_DIR ?? path.join(os.tmpdir(), "slackgram"),
  // Defaults to a directory inside the project rather than the OS tmp dir,
  // since shared hosts commonly mount /tmp `noexec`, which breaks yt-dlp's
  // self-extracting binary. Override with YTDLP_TMPDIR if needed (e.g. to
  // point at the OS tmp dir on hosts where that's actually fine).
  ytDlpTmpDir: process.env.YTDLP_TMPDIR ?? path.join(projectRoot, ".yt-dlp-tmp"),
  processTimeoutMs: intFromEnv("SLACKGRAM_TIMEOUT_MS", 120_000),
  port: intFromEnv("PORT", 3000),
  basePath: (process.env.BASE_PATH ?? "").replace(/\/+$/, ""),
  maxConcurrentJobs: intFromEnv("SLACKGRAM_MAX_CONCURRENT_JOBS", 4),
};

export { projectRoot };
