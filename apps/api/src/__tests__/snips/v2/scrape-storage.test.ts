import {
  describeIf,
  TEST_SELF_HOST,
  HAS_PLAYWRIGHT,
  TEST_SUITE_WEBSITE,
  ALLOW_TEST_SUITE_WEBSITE,
} from "../lib";
import {
  scrape,
  scrapeRaw,
  scrapeWithFailure,
  scrapeTimeout,
  idmux,
  Identity,
} from "./lib";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-storage",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

describeIf(TEST_SELF_HOST && HAS_PLAYWRIGHT)("Screenshot storage", () => {
  it.concurrent(
    "scrape without storage returns original behavior (base64 or supabase URL)",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
        },
        identity,
      );

      expect(response.screenshot).toBeDefined();
      // With no per-request storage the result depends on env config: a data
      // URI when none is set, otherwise whatever the env provider and
      // SCREENSHOT_STORAGE_URL_MODE produce (object URL, presigned, or a proxy
      // link back through this API). scrape-screenshot-url.test.ts is the one
      // that checks such a URL actually serves bytes.
      expect(response.screenshot).toMatch(/^(data:|https?:\/\/)/);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "rejects storage.provider='s3' without s3 config",
    async () => {
      const raw = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: {
            provider: "s3",
          } as any,
        },
        identity,
      );

      expect(raw.statusCode).toBe(400);
      expect(raw.body.success).toBe(false);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "rejects invalid storage provider",
    async () => {
      const raw = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: {
            provider: "invalid" as any,
          },
        },
        identity,
      );

      expect(raw.statusCode).toBe(400);
      expect(raw.body.success).toBe(false);
    },
    scrapeTimeout,
  );

  // This test requires a running MinIO/S3 instance
  // Set MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ACCESS_KEY, MINIO_SECRET_KEY env vars to run
  const HAS_MINIO = !!(
    process.env.MINIO_ENDPOINT &&
    process.env.MINIO_BUCKET &&
    process.env.MINIO_ACCESS_KEY &&
    process.env.MINIO_SECRET_KEY
  );

  (HAS_MINIO ? it : it.skip).concurrent(
    "uploads screenshot to S3/MinIO when storage config provided",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
          storage: {
            provider: "s3",
            s3: {
              endpoint: process.env.MINIO_ENDPOINT!,
              bucket: process.env.MINIO_BUCKET!,
              accessKeyId: process.env.MINIO_ACCESS_KEY!,
              secretAccessKey: process.env.MINIO_SECRET_KEY!,
              forcePathStyle: true,
              publicUrl: process.env.MINIO_PUBLIC_URL,
            },
          },
        },
        identity,
      );

      expect(response.screenshot).toBeDefined();
      // Should be an HTTP(S) URL, not base64
      expect(response.screenshot!.startsWith("http")).toBe(true);
      expect(response.screenshot).not.toContain("data:");
      expect(response.screenshot).toContain("screenshots/");

      // ...and it must actually serve the image. Asserting only on the shape
      // of the string is what let a private-bucket deployment ship URLs that
      // every client got a 403 from.
      const res = await fetch(response.screenshot!);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);
    },
    scrapeTimeout,
  );
});
