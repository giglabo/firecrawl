// Serves screenshots back out of the configured storage provider when
// SCREENSHOT_STORAGE_URL_MODE=proxy, so the bucket can stay private without
// handing out expiring links.
//
// No auth middleware, by design: the signed token in the path is the
// credential, exactly as with parse-upload's local upload route. See
// lib/storage/proxy-url.ts for what the token does and does not authorise.

import { Request, Response } from "express";
import { resolveProvider } from "../../lib/storage/factory";
import {
  isScreenshotProxyMode,
  verifyScreenshotToken,
} from "../../lib/storage/proxy-url";
import { logger } from "../../lib/logger";

export async function screenshotProxyController(
  req: Request<{ token: string }>,
  res: Response,
) {
  if (!isScreenshotProxyMode()) {
    return res.status(404).json({ success: false, error: "Not found" });
  }

  const key = verifyScreenshotToken(req.params.token);
  if (key === null) {
    // Same response for malformed, mis-signed and unknown tokens -- do not let
    // a caller distinguish "wrong signature" from "no such object".
    return res.status(404).json({ success: false, error: "Not found" });
  }

  const provider = resolveProvider();
  if (!provider?.fetch) {
    return res.status(404).json({ success: false, error: "Not found" });
  }

  let object: Awaited<ReturnType<NonNullable<typeof provider.fetch>>>;
  try {
    object = await provider.fetch(key);
  } catch (error) {
    logger.error("Failed to read screenshot from storage", { error, key });
    return res
      .status(502)
      .json({ success: false, error: "Failed to read screenshot" });
  }

  if (!object) {
    return res.status(404).json({ success: false, error: "Not found" });
  }

  res.setHeader("Content-Type", object.contentType ?? "image/png");
  res.setHeader("Content-Length", String(object.body.length));
  // Immutable: the key embeds a UUID, so a given URL always maps to one image.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.status(200).end(object.body);
}
