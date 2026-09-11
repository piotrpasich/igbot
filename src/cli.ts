#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { extractMedia, cleanupWorkDir } from "./lib/extractor";
import { zipMediaItems } from "./lib/archive";
import { DownloadError } from "./lib/types";
import { config } from "./config";

const program = new Command();

program
  .name("slackgram")
  .description("Download images/videos from Instagram and Facebook posts, reels, and stories")
  .version("1.0.0");

program
  .argument("<url>", "Instagram or Facebook post/reel/video URL")
  .option("-o, --output <dir>", "Directory to save downloaded files into", ".")
  .option("-c, --cookies <file>", "Netscape-format cookies file for authenticated content")
  .option("-z, --zip [file]", "Package all downloaded files into a single zip archive")
  .option("-t, --timeout <ms>", "Extraction timeout in milliseconds", (v) => Number.parseInt(v, 10))
  .option("--json", "Print result metadata as JSON to stdout")
  .action(async (url: string, opts: {
    output: string;
    cookies?: string;
    zip?: string | boolean;
    timeout?: number;
    json?: boolean;
  }) => {
    try {
      await runFetch(url, opts);
    } catch (err) {
      if (err instanceof DownloadError) {
        process.stderr.write(`Error [${err.code}]: ${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      process.stderr.write(`Unexpected error: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  });

async function runFetch(
  url: string,
  opts: { output: string; cookies?: string; zip?: string | boolean; timeout?: number; json?: boolean },
): Promise<void> {
  if (!opts.json) {
    process.stderr.write(`Fetching ${url} ...\n`);
  }

  const result = await extractMedia(url, {
    cookiesFile: opts.cookies,
    timeoutMs: opts.timeout,
  });

  try {
    const outputDir = path.resolve(opts.output);
    await fsp.mkdir(outputDir, { recursive: true });

    if (opts.zip) {
      const zipName = typeof opts.zip === "string" ? opts.zip : `${result.metadata.id ?? "slackgram"}.zip`;
      const zipPath = path.resolve(outputDir, zipName);
      const dest = fs.createWriteStream(zipPath);
      await zipMediaItems(result.items, dest);
      if (opts.json) {
        console.log(JSON.stringify({ ...result.metadata, zipFile: zipPath, itemCount: result.items.length }, null, 2));
      } else {
        process.stderr.write(`Saved ${result.items.length} file(s) to ${zipPath}\n`);
      }
      return;
    }

    const savedPaths: string[] = [];
    for (const item of result.items) {
      const dest = path.join(outputDir, item.fileName);
      await fsp.copyFile(item.filePath, dest);
      savedPaths.push(dest);
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ...result.metadata,
            files: result.items.map((item, i) => ({
              ...item,
              filePath: savedPaths[i],
            })),
          },
          null,
          2,
        ),
      );
    } else {
      process.stderr.write(`Saved ${savedPaths.length} file(s):\n`);
      for (const p of savedPaths) process.stderr.write(`  ${p}\n`);
    }
  } finally {
    await cleanupWorkDir(result.workDir);
  }
}

void fsp.mkdir(config.tmpDir, { recursive: true }).then(() => program.parseAsync(process.argv));
