export type Platform = "instagram" | "facebook";

export type MediaKind = "image" | "video" | "audio";

/** A single downloadable media file resolved from a source URL. */
export interface MediaItem {
  kind: MediaKind;
  /** Absolute path to the downloaded file on disk. */
  filePath: string;
  /** File name, safe for use in a Content-Disposition header. */
  fileName: string;
  /** MIME type, best-effort guess based on the file extension. */
  mimeType: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** Width in pixels, when known (video/image). */
  width?: number;
  /** Height in pixels, when known (video/image). */
  height?: number;
  /** Duration in seconds, when known (video/audio). */
  durationSeconds?: number;
}

export interface ExtractionMetadata {
  platform: Platform;
  sourceUrl: string;
  /** Post/reel/video id as reported by the extractor, when available. */
  id?: string;
  title?: string;
  description?: string;
  uploader?: string;
  uploaderUrl?: string;
}

export interface ExtractionResult {
  metadata: ExtractionMetadata;
  items: MediaItem[];
  /** Absolute path to the temp directory holding all downloaded files; caller is responsible for cleanup. */
  workDir: string;
}

export interface DownloadOptions {
  /** Path to a Netscape-format cookies file to use for this request (overrides the default). */
  cookiesFile?: string;
  /** Max time in milliseconds to allow the extraction to run. */
  timeoutMs?: number;
}

export class DownloadError extends Error {
  constructor(
    override message: string,
    readonly code:
      | "UNSUPPORTED_URL"
      | "LOGIN_REQUIRED"
      | "NOT_FOUND"
      | "EXTRACTION_FAILED"
      | "TIMEOUT"
      | "INTERNAL",
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}
