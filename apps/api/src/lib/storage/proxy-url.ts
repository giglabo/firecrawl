// Screenshot proxy links: SCREENSHOT_STORAGE_URL_MODE=proxy hands back a URL
// pointing at this API rather than at the object store, so the bucket can stay
// private.
//
// Wire format follows upstream's parse-upload refs -- base64url(JSON payload)
// + "." + base64url(HMAC-SHA256) -- so there is one signing idiom in the
// codebase and merges have less to argue about. The payload carries an expiry,
// matching both upstream's ParseUploadRefPayload.expiresAt and the exp field
// in our own watchword proxy signer: an unauthenticated link that never dies
// is a standing liability if it leaks. Set SCREENSHOT_PROXY_URL_TTL=0 to opt
// into permanent links deliberately.
//
// The token authorises exactly one object. It is not an API key and carries no
// team identity: anyone holding a live link can read that one screenshot,
// which is the same exposure as the presigned-URL mode.

import crypto from "crypto";
import { config } from "../../config";

const SEPARATOR = ".";
const PAYLOAD_VERSION = 1;

type ScreenshotTokenPayload = {
  v: number;
  key: string;
  // Unix seconds. 0 means "never expires".
  exp: number;
};

type ScreenshotTokenResult =
  | { ok: true; key: string }
  | { ok: false; reason: "invalid" | "expired" };

export function isScreenshotProxyMode(): boolean {
  return config.SCREENSHOT_STORAGE_URL_MODE === "proxy";
}

function sign(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function signScreenshotKey(key: string): string {
  const secret = config.SCREENSHOT_PROXY_SECRET;
  if (!secret) {
    throw new Error(
      "SCREENSHOT_PROXY_SECRET is required when SCREENSHOT_STORAGE_URL_MODE=proxy.",
    );
  }

  const ttl = config.SCREENSHOT_PROXY_URL_TTL;
  const payload: ScreenshotTokenPayload = {
    v: PAYLOAD_VERSION,
    key,
    exp: ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : 0,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}${SEPARATOR}${sign(encodedPayload, secret)}`;
}

export function verifyScreenshotToken(token: string): ScreenshotTokenResult {
  const secret = config.SCREENSHOT_PROXY_SECRET;
  if (!secret) return { ok: false, reason: "invalid" };

  const [encodedPayload, signature, extra] = token.split(SEPARATOR);
  if (!encodedPayload || !signature || extra !== undefined) {
    return { ok: false, reason: "invalid" };
  }

  // Signature first, expiry second. The payload is caller-supplied, so
  // checking expiry first would let anyone get "expired" out of a token they
  // made up; this way only a genuinely signed token can produce that answer.
  const expected = sign(encodedPayload, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return { ok: false, reason: "invalid" };
  if (!crypto.timingSafeEqual(given, want)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: ScreenshotTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString(),
    ) as ScreenshotTokenPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (
    payload?.v !== PAYLOAD_VERSION ||
    typeof payload.key !== "string" ||
    payload.key.length === 0 ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (payload.exp !== 0 && Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, key: payload.key };
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
