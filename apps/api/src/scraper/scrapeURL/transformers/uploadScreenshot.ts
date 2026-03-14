// This file is an exception to the "no supabase in scrapeURL" rule,
// and it makes me sad. - mogery

import { supabase_service } from "../../../services/supabase";
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

async function uploadSingleScreenshot(
  meta: Meta,
  dataUri: string,
  format?: "png" | "jpeg" | "webp",
  quality?: number,
): Promise<string> {
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
    const prefix = config.SCREENSHOT_STORAGE_S3_PREFIX
      ? `${config.SCREENSHOT_STORAGE_S3_PREFIX.replace(/\/+$/, "")}/`
      : "";
    const key = `${prefix}${meta.id}-${crypto.randomUUID()}.${ext}`;
    try {
      meta.logger.debug("Uploading screenshot to storage provider...");
      const result = await provider.upload(buffer, key, contentType);
      return result.url;
    } catch (error) {
      meta.logger.error(
        `Failed to upload screenshot to storage provider: ${error}`,
      );
      return dataUri;
    }
  }

  // Original Supabase path (cloud-only)
  if (config.USE_DB_AUTHENTICATION) {
    meta.logger.debug("Uploading screenshot to Supabase...");
    const fileName = `screenshot-${crypto.randomUUID()}.${ext}`;

    try {
      await supabase_service.storage.from("media").upload(fileName, buffer, {
        cacheControl: "3600",
        upsert: false,
        contentType,
      });

      return `https://service.firecrawl.dev/storage/v1/object/public/media/${encodeURIComponent(fileName)}`;
    } catch (error) {
      meta.logger.error(`Failed to upload screenshot to Supabase: ${error}`);
    }
  }

  return dataUri;
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
    document.screenshot = await uploadSingleScreenshot(
      meta,
      document.screenshot,
      ssFormat,
      ssQuality,
    );
  }

  // Upload screenshots array
  if (document.screenshots?.length) {
    const uploaded: string[] = [];
    for (const ss of document.screenshots) {
      if (!ss.startsWith("data:")) {
        uploaded.push(ss);
        continue;
      }
      uploaded.push(
        await uploadSingleScreenshot(meta, ss, ssFormat, ssQuality),
      );
    }
    document.screenshots = uploaded;
  }

  return document;
}
