import fs from "node:fs";
import archiver from "archiver";
import type { MediaItem } from "./types";

/**
 * Streams a zip archive containing all given media items to the destination
 * writable stream (e.g. an HTTP response or a file). Resolves once the
 * archive has been fully written and flushed.
 */
export function zipMediaItems(items: MediaItem[], destination: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("warning", (err: archiver.ArchiverError) => {
      if (err.code === "ENOENT") return;
      reject(err);
    });
    archive.on("error", reject);
    destination.on("error", reject);
    destination.on("close", resolve);
    destination.on("finish", resolve);

    archive.pipe(destination);

    const usedNames = new Set<string>();
    for (const item of items) {
      const name = dedupeName(item.fileName, usedNames);
      archive.append(fs.createReadStream(item.filePath), { name });
    }

    void archive.finalize();
  });
}

function dedupeName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }
  const dotIndex = fileName.lastIndexOf(".");
  const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : "";
  let counter = 2;
  let candidate = `${base}-${counter}${ext}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}${ext}`;
  }
  used.add(candidate);
  return candidate;
}
