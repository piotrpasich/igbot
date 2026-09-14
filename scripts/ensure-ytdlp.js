#!/usr/bin/env node
// postinstall hook: makes sure ./bin/yt-dlp exists and is executable.
// Skips silently (with a warning) on unsupported platforms or when a
// YTDLP_PATH override is already configured — the app will fall back to
// a `yt-dlp` found on PATH in that case.
"use strict";

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const binDir = path.join(projectRoot, "bin");
const dest = path.join(binDir, "yt-dlp");

// The standalone yt-dlp_linux binary self-extracts its bundled Python
// runtime into TMPDIR and executes from there. Some shared hosts mount
// /tmp `noexec`, which breaks that. Default to a project-local dir instead
// (overridable via YTDLP_TMPDIR), matching src/config.ts at runtime.
const ytDlpTmpDir = process.env.YTDLP_TMPDIR || path.join(projectRoot, ".yt-dlp-tmp");
fs.mkdirSync(ytDlpTmpDir, { recursive: true });
const execEnv = { ...process.env, TMPDIR: ytDlpTmpDir };

function alreadyWorking() {
  if (!fs.existsSync(dest)) return false;
  try {
    fs.accessSync(dest, fs.constants.X_OK);
  } catch {
    return false;
  }
  const result = spawnSync(dest, ["--version"], { stdio: "ignore", env: execEnv });
  return result.status === 0;
}

function main() {
  if (process.env.YTDLP_PATH) {
    console.log(`[slackgram] YTDLP_PATH is set to "${process.env.YTDLP_PATH}"; skipping bundled yt-dlp download.`);
    return;
  }

  if (alreadyWorking()) {
    console.log("[slackgram] bin/yt-dlp already present and working.");
    return;
  }

  if (process.platform !== "linux") {
    console.warn(
      `[slackgram] Automatic yt-dlp download is only wired up for Linux (detected "${process.platform}"). ` +
        "Install yt-dlp yourself (e.g. `pip install yt-dlp` or a platform binary from " +
        "https://github.com/yt-dlp/yt-dlp/releases) and point YTDLP_PATH at it, or place the binary at bin/yt-dlp.",
    );
    return;
  }

  fs.mkdirSync(binDir, { recursive: true });
  const version = process.env.YTDLP_VERSION || "latest";
  const url =
    version === "latest"
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
      : `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp_linux`;

  console.log(`[slackgram] Downloading yt-dlp (${version}) from ${url} ...`);
  try {
    execFileSync("curl", ["-sL", "-o", dest, url], { stdio: "inherit" });
    fs.chmodSync(dest, 0o755);
    execFileSync(dest, ["--version"], { stdio: "inherit", env: execEnv });
    console.log(`[slackgram] yt-dlp installed at ${dest}`);
  } catch (err) {
    console.warn(
      `[slackgram] Failed to download yt-dlp automatically (${err.message}). ` +
        "Run `npm run setup:ytdlp` manually, or set YTDLP_PATH to an existing install.",
    );
  }
}

main();
