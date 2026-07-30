// The screenshot URL we hand back must actually be fetchable.
//
// scrape-storage.test.ts already asserts the response *looks* like a URL
// (starts with http, contains the prefix). That is what let a broken
// deployment ship: uploads succeeded, the URL looked right, and every fetch of
// it returned 403 because the bucket was private while the code assumed a
// world-readable one. These tests fetch the URL.
//
// Runs against SCREENSHOT_STORAGE_URL_MODE=proxy, where the API streams the
// object back from the env-configured provider and the signed token in the
// path is the credential.
import {
  describeIf,
  TEST_SELF_HOST,
  HAS_PLAYWRIGHT,
  TEST_SUITE_WEBSITE,
  ALLOW_TEST_SUITE_WEBSITE,
} from "../lib";
import { scrape, scrapeTimeout, idmux, Identity } from "./lib";
import crypto from "crypto";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-screenshot-url",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

const PROXY_MODE = process.env.SCREENSHOT_STORAGE_URL_MODE === "proxy";

describeIf(
  TEST_SELF_HOST && HAS_PLAYWRIGHT && ALLOW_TEST_SUITE_WEBSITE && PROXY_MODE,
)("Screenshot URL is fetchable", () => {
  let screenshotUrl: string;

  beforeAll(async () => {
    const response = await scrape(
      { url: TEST_SUITE_WEBSITE, formats: ["screenshot"] },
      identity,
    );
    if (!response.screenshot) {
      throw new Error("scrape returned no screenshot");
    }
    screenshotUrl = response.screenshot;
  }, scrapeTimeout);

  it("returns a proxy URL rather than a raw object URL", () => {
    expect(screenshotUrl.startsWith("data:")).toBe(false);
    expect(screenshotUrl).toContain("/v2/screenshot/");
  });

  it(
    "serves the image bytes over that URL",
    async () => {
      const res = await fetch(screenshotUrl);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);

      const body = Buffer.from(await res.arrayBuffer());
      expect(body.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  // Failure path: the token is the only credential, so a tampered one must not
  // resolve -- and must not reveal whether the object exists.
  it(
    "rejects a tampered token with 404",
    async () => {
      const [prefix, token] = screenshotUrl.split("/v2/screenshot/");
      const [payload, signature] = token.split(".");

      const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

      const badSignature = `${prefix}/v2/screenshot/${payload}.${flip(signature)}`;
      const badPayload = `${prefix}/v2/screenshot/${flip(payload)}.${signature}`;

      for (const url of [badSignature, badPayload]) {
        const res = await fetch(url);
        expect(res.status).toBe(404);
      }
    },
    scrapeTimeout,
  );

  it(
    "rejects a malformed token with 404",
    async () => {
      const [prefix] = screenshotUrl.split("/v2/screenshot/");
      const res = await fetch(`${prefix}/v2/screenshot/not-a-token`);
      expect(res.status).toBe(404);
    },
    scrapeTimeout,
  );

  it("issues tokens that carry an expiry", () => {
    const [, token] = screenshotUrl.split("/v2/screenshot/");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString(),
    );

    expect(payload.v).toBe(1);
    expect(typeof payload.key).toBe("string");
    // 0 would mean a permanent link; the suite runs with the default TTL.
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  // A validly signed but aged-out link must be refused, and distinguishably so
  // -- 410 rather than 404, since only a real signature can reach this branch.
  (process.env.SCREENSHOT_PROXY_SECRET ? it : it.skip)(
    "rejects an expired but correctly signed token with 410",
    async () => {
      const [prefix, token] = screenshotUrl.split("/v2/screenshot/");
      const key = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString(),
      ).key;

      const expired = Buffer.from(
        JSON.stringify({
          v: 1,
          key,
          exp: Math.floor(Date.now() / 1000) - 60,
        }),
      ).toString("base64url");
      const signature = crypto
        .createHmac("sha256", process.env.SCREENSHOT_PROXY_SECRET!)
        .update(expired)
        .digest("base64url");

      const res = await fetch(
        `${prefix}/v2/screenshot/${expired}.${signature}`,
      );
      expect(res.status).toBe(410);
    },
    scrapeTimeout,
  );
});

// Presigned mode (SCREENSHOT_STORAGE_URL_MODE=signed globally, or
// storage.s3.signedUrls per request). Exercised here through the per-request
// path so one server can cover both modes.
//
// It runs against a bucket that is NOT public, and asserts that first: against
// the public bucket a broken signer would still return 200 and the test would
// prove nothing.
const HAS_PRIVATE_MINIO = !!(
  process.env.MINIO_ENDPOINT &&
  process.env.MINIO_PRIVATE_BUCKET &&
  process.env.MINIO_ACCESS_KEY &&
  process.env.MINIO_SECRET_KEY
);

const privateS3 = () => ({
  endpoint: process.env.MINIO_ENDPOINT!,
  bucket: process.env.MINIO_PRIVATE_BUCKET!,
  accessKeyId: process.env.MINIO_ACCESS_KEY!,
  secretAccessKey: process.env.MINIO_SECRET_KEY!,
  forcePathStyle: true,
});

describeIf(
  TEST_SELF_HOST &&
    HAS_PLAYWRIGHT &&
    ALLOW_TEST_SUITE_WEBSITE &&
    HAS_PRIVATE_MINIO,
)("Presigned screenshot URLs", () => {
  it(
    "control: an unsigned URL into the private bucket is not readable",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: { provider: "s3", s3: privateS3() } as any,
        },
        identity,
      );

      expect(response.screenshot).toBeDefined();
      expect(response.screenshot).not.toContain("X-Amz-Signature");

      const res = await fetch(response.screenshot!);
      expect(res.status).toBeGreaterThanOrEqual(400);
    },
    scrapeTimeout,
  );

  it(
    "serves the image over a presigned URL",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: {
            provider: "s3",
            s3: { ...privateS3(), signedUrls: true },
          } as any,
        },
        identity,
      );

      expect(response.screenshot).toBeDefined();
      expect(response.screenshot).toContain("X-Amz-Signature");
      expect(response.screenshot).toContain("X-Amz-Expires");

      const res = await fetch(response.screenshot!);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);

      const body = Buffer.from(await res.arrayBuffer());
      expect(body.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it(
    "honours the requested expiry",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: {
            provider: "s3",
            s3: { ...privateS3(), signedUrls: true, signedUrlTtlSeconds: 120 },
          } as any,
        },
        identity,
      );

      const expires = new URL(response.screenshot!).searchParams.get(
        "X-Amz-Expires",
      );
      expect(expires).toBe("120");
    },
    scrapeTimeout,
  );
});
