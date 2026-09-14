import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import fs from "node:fs/promises";
import { config } from "./config";
import { downloadRouter } from "./routes/download";
import { DownloadError } from "./lib/types";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.disable("x-powered-by");

  const { basePath } = config;

  app.get(`${basePath}/health`, (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(`${basePath}/api`, downloadRouter);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `No such route: ${req.method} ${req.path}` });
  });

  // Centralized error handler: converts DownloadError into a stable JSON
  // shape with an appropriate HTTP status code; anything else becomes a 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DownloadError) {
      const statusByCode: Record<DownloadError["code"], number> = {
        UNSUPPORTED_URL: 400,
        LOGIN_REQUIRED: 422,
        NOT_FOUND: 404,
        EXTRACTION_FAILED: 502,
        TIMEOUT: 504,
        INTERNAL: 500,
      };
      res.status(statusByCode[err.code]).json({ error: err.message, code: err.code });
      return;
    }

    // eslint-disable-next-line no-console
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

async function main(): Promise<void> {
  await fs.mkdir(config.tmpDir, { recursive: true });
  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`slackgram API listening on port ${config.port}`);
  });
}

void main();
