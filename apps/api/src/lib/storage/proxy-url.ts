// Screenshot proxy links: SCREENSHOT_STORAGE_URL_MODE=proxy hands back a URL
// pointing at this API rather than at the object store, so the bucket can stay
// private and the link never expires.
//
// The token is an HMAC over the object key, using the same construction as
// upstream's parse-upload refs (base64url payload + "." + base64url signature,
// compared with timingSafeEqual). Keeping the scheme identical means one idiom
// to reason about, and it survives merges better than a bespoke format.
//
// The token authorises exactly one object. It is not an API key and carries no
// team identity: anyone holding the link can read that one screenshot, which is
// the same exposure as the presigned-URL mode, minus the expiry.

import crypto from "crypto";
import { config } from "../../config";

const SEPARATOR = ".";

export function isScreenshotProxyMode(): boolean {
  return config.SCREENSHOT_STORAGE_URL_MODE === "proxy";
}

function requireSecret(): string {
  const secret = config.SCREENSHOT_PROXY_SECRET;
  if (!secret) {
    throw new Error(
      "SCREENSHOT_PROXY_SECRET is required when SCREENSHOT_STORAGE_URL_MODE=proxy.",
    );
  }
  return secret;
}

function sign(encodedKey: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedKey)
    .digest("base64url");
}

function signScreenshotKey(key: string): string {
  const secret = requireSecret();
  const encodedKey = Buffer.from(key).toString("base64url");
  return `${encodedKey}${SEPARATOR}${sign(encodedKey, secret)}`;
}

/** Returns the object key, or null if the token is malformed or not ours. */
export function verifyScreenshotToken(token: string): string | null {
  const secret = config.SCREENSHOT_PROXY_SECRET;
  if (!secret) return null;

  const [encodedKey, signature, extra] = token.split(SEPARATOR);
  if (!encodedKey || !signature || extra !== undefined) return null;

  const expected = sign(encodedKey, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;

  const key = Buffer.from(encodedKey, "base64url").toString();
  return key.length > 0 ? key : null;
}

export function buildScreenshotProxyUrl(key: string): string {
  const base = config.SCREENSHOT_PROXY_BASE_URL;
  if (!base) {
    throw new Error(
      "SCREENSHOT_PROXY_BASE_URL is required when SCREENSHOT_STORAGE_URL_MODE=proxy.",
    );
  }
  return `${base.replace(/\/+$/, "")}/v2/screenshot/${signScreenshotKey(key)}`;
}
