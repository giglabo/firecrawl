// Upstream deleted this transformer along with its Supabase storage upload
// (the Supabase SDK was dropped entirely in the move to Drizzle). We keep the
// transformer because our pluggable storage providers live here; the Supabase
// upload path is gone, so the chain is: storage provider -> data URI.

import { config } from "../../../config";
import { Meta } from "..";
import { Document } from "../../../controllers/v1/types";
import { resolveProvider } from "../../../lib/storage/factory";
import { hasFormatOfType } from "../../../lib/format-utils";
import { convertImageToWebp } from "@mendable/firecrawl-rs";

/**
 * Parse a screenshot select string into a set of 0-based indices.
 *
 * Supported syntax (1-based, case-insensitive):
 *   "all"           → all screenshots
 *   "1"             → first only
 *   "first"         → alias for 1
 *   "last"          → last only
 *   "first,last"    → first and last
 *   "1,3,5"         → specific indices
 *   "2-5"           → range (inclusive)
 *   "1,2-5,last"    → combination
 *
 * Out-of-range indices/ranges are silently ignored.
 * Returns undefined when all items should be kept.
 */
function parseScreenshotSelect(
  select: string | undefined,
  total: number,
): number[] | undefined {
  if (!select || total === 0) return undefined;

  const normalized = select.trim().toLowerCase();
  if (normalized === "all") return undefined;

  const indices = new Set<number>();

  for (const part of normalized.split(",")) {
    const token = part.trim();
    if (!token) continue;

    if (token === "first") {
      indices.add(0);
      continue;
    }
    if (token === "last") {
      indices.add(total - 1);
      continue;
    }

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        const idx = i - 1; // convert to 0-based
        if (idx >= 0 && idx < total) {
          indices.add(idx);
        }
      }
      continue;
    }

    const num = parseInt(token, 10);
    if (!isNaN(num)) {
      const idx = num - 1; // convert to 0-based
      if (idx >= 0 && idx < total) {
        indices.add(idx);
      }
    }
  }

  if (indices.size === 0) return undefined;
  return Array.from(indices).sort((a, b) => a - b);
}

interface UploadResult {
  url: string;
  path?: string;
}

async function uploadSingleScreenshot(
  meta: Meta,
  dataUri: string,
  format?: "png" | "jpeg" | "webp",
  quality?: number,
): Promise<UploadResult> {
  let contentType = dataUri.split(":")[1].split(";")[0];
  const base64Data = dataUri.split(",")[1];
  let buffer = Buffer.from(base64Data, "base64");
  let ext = contentType.split("/")[1] || "png";

  if (format === "webp") {
    try {
      buffer = convertImageToWebp(buffer, quality ?? 90);
      contentType = "image/webp";
      ext = "webp";
    } catch (error) {
      meta.logger.error(`Failed to convert screenshot to WebP: ${error}`);
    }
  }

  // Tenant storage path: request-level config takes priority
  const provider = resolveProvider(meta.options.storage);
  if (provider) {
    const rawPrefix =
      meta.options.storage?.prefix ?? config.SCREENSHOT_STORAGE_S3_PREFIX;
    const prefix = rawPrefix ? `${rawPrefix.replace(/\/+$/, "")}/` : "";
    const key = `${prefix}${meta.id}-${crypto.randomUUID()}.${ext}`;
    try {
      meta.logger.debug("Uploading screenshot to storage provider...");
      const result = await provider.upload(buffer, key, contentType);
      return { url: result.url, path: result.path };
    } catch (error) {
      meta.logger.error(
        `Failed to upload screenshot to storage provider: ${error}`,
      );
      return { url: dataUri };
    }
  }

  // No provider configured: hand the caller an inline data URI. Set
  // SCREENSHOT_STORAGE_PROVIDER (or pass `storage` per request) to get URLs.
  meta.logger.debug(
    "No screenshot storage provider configured, returning data URI",
  );
  return { url: dataUri };
}

export async function uploadScreenshot(
  meta: Meta,
  document: Document,
): Promise<Document> {
  // Apply screenshot selection filter before uploading
  const screenshotFormat = hasFormatOfType(meta.options.formats, "screenshot");
  if (screenshotFormat?.select && document.screenshots?.length) {
    const selectedIndices = parseScreenshotSelect(
      screenshotFormat.select,
      document.screenshots.length,
    );
    if (selectedIndices) {
      document.screenshots = selectedIndices.map(i => document.screenshots![i]);
    }
  }

  const ssFormat = screenshotFormat?.format;
  const ssQuality = screenshotFormat?.quality;

  // Upload single screenshot
  if (
    document.screenshot !== undefined &&
    document.screenshot.startsWith("data:")
  ) {
    const result = await uploadSingleScreenshot(
      meta,
      document.screenshot,
      ssFormat,
      ssQuality,
    );
    document.screenshot = result.url;
    if (result.path) {
      document.screenshotPath = result.path;
    }
  }

  // Upload screenshots array in batches
  if (document.screenshots?.length) {
    const concurrency = config.SCREENSHOT_UPLOAD_CONCURRENCY ?? 6;
    const urls: string[] = [];
    const paths: string[] = [];
    for (let i = 0; i < document.screenshots.length; i += concurrency) {
      const batch = document.screenshots.slice(i, i + concurrency);
      const uploaded = await Promise.all(
        batch.map(ss =>
          ss.startsWith("data:")
            ? uploadSingleScreenshot(meta, ss, ssFormat, ssQuality)
            : Promise.resolve({ url: ss } as UploadResult),
        ),
      );
      for (const r of uploaded) {
        urls.push(r.url);
        if (r.path) paths.push(r.path);
      }
    }
    document.screenshots = urls;
    if (paths.length > 0) {
      document.screenshotPaths = paths;
    }
  }

  return document;
}
