// This file is an exception to the "no supabase in scrapeURL" rule,
// and it makes me sad. - mogery

import { supabase_service } from "../../../services/supabase";
import { config } from "../../../config";
import { Meta } from "..";
import { Document } from "../../../controllers/v1/types";
import { resolveProvider } from "../../../lib/storage/factory";

async function uploadSingleScreenshot(
  meta: Meta,
  dataUri: string,
): Promise<string> {
  const contentType = dataUri.split(":")[1].split(";")[0];
  const base64Data = dataUri.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");
  const ext = contentType.split("/")[1] || "png";

  // Tenant storage path: request-level config takes priority
  const provider = resolveProvider(meta.options.storage);
  if (provider) {
    const key = `screenshots/${meta.id}-${crypto.randomUUID()}.${ext}`;
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
    const fileName = `screenshot-${crypto.randomUUID()}.png`;

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
  // Upload single screenshot
  if (
    document.screenshot !== undefined &&
    document.screenshot.startsWith("data:")
  ) {
    document.screenshot = await uploadSingleScreenshot(
      meta,
      document.screenshot,
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
      uploaded.push(await uploadSingleScreenshot(meta, ss));
    }
    document.screenshots = uploaded;
  }

  return document;
}
