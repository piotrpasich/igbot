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

export interface AppConfig {
  /** Path (or bare command name) used to invoke yt-dlp. */
  ytDlpPath: string;
  /** Optional path to a Netscape-format cookies file, used by default when none is supplied per-request. */
  defaultCookiesFile?: string;
  /** Directory where temporary per-request download folders are created. */
  tmpDir: string;
  /** Max time (ms) allowed for a single yt-dlp invocation before it's killed. */
  processTimeoutMs: number;
  /** HTTP server port. */
  port: number;
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
  tmpDir: process.env.SLACKGRAM_TMP_DIR ?? path.join(os.tmpdir(), "slackgram"),
  processTimeoutMs: intFromEnv("SLACKGRAM_TIMEOUT_MS", 120_000),
  port: intFromEnv("PORT", 3000),
  maxConcurrentJobs: intFromEnv("SLACKGRAM_MAX_CONCURRENT_JOBS", 4),
};

export { projectRoot };
