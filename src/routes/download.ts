import { Router, type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import { extractMedia, cleanupWorkDir } from "../lib/extractor";
import { zipMediaItems } from "../lib/archive";
import { DownloadError } from "../lib/types";
import { Semaphore } from "../lib/semaphore";
import { config } from "../config";

export const downloadRouter = Router();

const jobSemaphore = new Semaphore(config.maxConcurrentJobs);

const ERROR_STATUS: Record<DownloadError["code"], number> = {
  UNSUPPORTED_URL: 400,
  LOGIN_REQUIRED: 422,
  NOT_FOUND: 404,
  EXTRACTION_FAILED: 502,
  TIMEOUT: 504,
  INTERNAL: 500,
};

function parseUrlParam(req: Request): string {
  const url = (req.method === "GET" ? req.query.url : req.body?.url) as unknown;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new DownloadError("Missing required 'url' parameter", "UNSUPPORTED_URL");
  }
  return url.trim();
}

/**
 * GET/POST /api/metadata?url=...
 * Resolves media without leaving a lingering response stream open;
 * returns JSON describing the discovered items plus a per-item download
 * link. Downloaded temp files are cleaned up immediately after the
 * response is prepared unless the client requests via /api/download
 * instead (which streams the actual bytes).
 */
downloadRouter.get("/metadata", metadataHandler);
downloadRouter.post("/metadata", metadataHandler);

async function metadataHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const release = await jobSemaphore.acquire();
  try {
    const url = parseUrlParam(req);
    const cookiesFile = (req.query.cookies as string | undefined) ?? (req.body?.cookies as string | undefined);

    const result = await extractMedia(url, { cookiesFile });
    try {
      res.json({
        platform: result.metadata.platform,
        sourceUrl: result.metadata.sourceUrl,
        id: result.metadata.id,
        title: result.metadata.title,
        description: result.metadata.description,
        uploader: result.metadata.uploader,
        items: result.items.map((item, index) => ({
          index,
          kind: item.kind,
          fileName: item.fileName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          width: item.width,
          height: item.height,
          durationSeconds: item.durationSeconds,
        })),
      });
    } finally {
      await cleanupWorkDir(result.workDir);
    }
  } catch (err) {
    next(err);
  } finally {
    release();
  }
}

/**
 * GET/POST /api/download?url=...&format=zip|file&index=0
 * Streams the actual media bytes. Defaults to a zip archive when the post
 * contains multiple items or `format=zip` is passed; otherwise streams the
 * single file directly. Use `index` to pick one item from a multi-item
 * carousel post without zipping.
 */
downloadRouter.get("/download", downloadHandler);
downloadRouter.post("/download", downloadHandler);

async function downloadHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const release = await jobSemaphore.acquire();
  let workDir: string | undefined;
  try {
    const url = parseUrlParam(req);
    const cookiesFile = (req.query.cookies as string | undefined) ?? (req.body?.cookies as string | undefined);
    const format = (req.query.format as string | undefined) ?? (req.body?.format as string | undefined);
    const indexParam = (req.query.index as string | undefined) ?? (req.body?.index as string | undefined);

    const result = await extractMedia(url, { cookiesFile });
    workDir = result.workDir;

    const wantsZip = format === "zip" || (result.items.length > 1 && indexParam === undefined);

    if (wantsZip) {
      const zipName = `${result.metadata.id ?? "slackgram"}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
      await zipMediaItems(result.items, res);
      return;
    }

    const index = indexParam !== undefined ? Number.parseInt(indexParam, 10) : 0;
    const item = result.items[index];
    if (!item) {
      throw new DownloadError(`No media item at index ${index} (post has ${result.items.length} item(s))`, "NOT_FOUND");
    }

    res.setHeader("Content-Type", item.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${item.fileName}"`);
    res.setHeader("Content-Length", item.sizeBytes.toString());

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(item.filePath);
      stream.on("error", reject);
      res.on("close", resolve);
      res.on("finish", resolve);
      stream.pipe(res);
    });
  } catch (err) {
    next(err);
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
    release();
  }
}
