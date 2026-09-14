import { spawn } from "node:child_process";
import fs from "node:fs";
import { config } from "../config";
import { DownloadError } from "./types";

export interface YtDlpRunResult {
  stdout: string;
  stderr: string;
}

export interface YtDlpRunOptions {
  /** Extra CLI args placed before the URL. */
  args: string[];
  url: string;
  cookiesFile?: string;
  timeoutMs?: number;
}

/**
 * Runs the yt-dlp binary with the given arguments and returns its stdout.
 * Classifies common failure modes (login walls, unsupported URLs, timeouts)
 * into a DownloadError with a stable `code` so callers/API responses can
 * react appropriately.
 */
export function runYtDlp(options: YtDlpRunOptions): Promise<YtDlpRunResult> {
  const { args, url, cookiesFile, timeoutMs = config.processTimeoutMs } = options;

  const fullArgs = [
    "--no-warnings",
    "--no-color",
    "--ignore-config",
    ...args,
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    ...(config.ffmpegPath ? ["--ffmpeg-location", config.ffmpegPath] : []),
    "--",
    url,
  ];

  if (config.ytDlpTmpDir) {
    fs.mkdirSync(config.ytDlpTmpDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(config.ytDlpPath, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: config.ytDlpTmpDir ? { ...process.env, TMPDIR: config.ytDlpTmpDir } : process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new DownloadError(
            `yt-dlp executable not found at "${config.ytDlpPath}". Set YTDLP_PATH or place a binary at bin/yt-dlp.`,
            "INTERNAL",
            err,
          ),
        );
        return;
      }
      reject(new DownloadError(`Failed to launch yt-dlp: ${err.message}`, "INTERNAL", err));
    });

    child.on("close", (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (timedOut) {
        reject(new DownloadError(`Extraction timed out after ${timeoutMs}ms`, "TIMEOUT"));
        return;
      }

      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(classifyFailure(stderr, exitCode));
    });
  });
}

function classifyFailure(stderr: string, exitCode: number | null): DownloadError {
  const text = stderr.toLowerCase();

  if (
    text.includes("login required") ||
    text.includes("empty media response") ||
    text.includes("rate-limit reached") ||
    (text.includes("cookies") && text.includes("provide account credentials"))
  ) {
    return new DownloadError(
      "This content requires being logged in (or is rate-limited). Provide a cookies file to authenticate.",
      "LOGIN_REQUIRED",
      stderr,
    );
  }

  if (
    text.includes("unsupported url") ||
    text.includes("no extractor") ||
    text.includes("unable to extract")
  ) {
    return new DownloadError("The URL is not supported or could not be parsed", "UNSUPPORTED_URL", stderr);
  }

  if (
    text.includes("404") ||
    text.includes("not found") ||
    text.includes("content isn't available") ||
    text.includes("this content isn't available") ||
    text.includes("page not found")
  ) {
    return new DownloadError("The requested content was not found (it may be private or deleted)", "NOT_FOUND", stderr);
  }

  return new DownloadError(
    `yt-dlp exited with code ${exitCode ?? "unknown"}: ${firstErrorLine(stderr)}`,
    "EXTRACTION_FAILED",
    stderr,
  );
}

function firstErrorLine(stderr: string): string {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? "unknown error";
}
