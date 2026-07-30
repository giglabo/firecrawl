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

  const verdict = verifyScreenshotToken(req.params.token);
  if (!verdict.ok) {
    if (verdict.reason === "expired") {
      // 410 only ever comes back for a genuinely signed token (the signature is
      // checked first), so telling the caller its link aged out leaks nothing
      // they could not already prove -- and lets them ask for a fresh scrape.
      return res
        .status(410)
        .json({ success: false, error: "Screenshot link has expired" });
    }
    // Malformed, mis-signed and unknown all look the same: do not let a caller
    // distinguish "wrong signature" from "no such object".
    return res.status(404).json({ success: false, error: "Not found" });
  }
  const key = verdict.key;

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
