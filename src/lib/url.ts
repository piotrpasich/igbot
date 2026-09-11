import { DownloadError, type Platform } from "./types";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "fb.watch",
]);

/**
 * Validates that the given string is an http(s) URL pointing at a supported
 * platform, and returns which platform it belongs to. Throws a
 * DownloadError with code UNSUPPORTED_URL otherwise.
 */
export function detectPlatform(rawUrl: string): { platform: Platform; url: URL } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DownloadError(`"${rawUrl}" is not a valid URL`, "UNSUPPORTED_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DownloadError(`Unsupported URL scheme "${url.protocol}"`, "UNSUPPORTED_URL");
  }

  const host = url.hostname.toLowerCase();

  if (INSTAGRAM_HOSTS.has(host)) {
    return { platform: "instagram", url };
  }
  if (FACEBOOK_HOSTS.has(host)) {
    return { platform: "facebook", url };
  }

  throw new DownloadError(
    `"${rawUrl}" is not an Instagram or Facebook URL`,
    "UNSUPPORTED_URL",
  );
}

export function isSupportedUrl(rawUrl: string): boolean {
  try {
    detectPlatform(rawUrl);
    return true;
  } catch {
    return false;
  }
}
