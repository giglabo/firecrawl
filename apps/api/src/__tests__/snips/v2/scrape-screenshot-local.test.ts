// Proxy mode over the LOCAL storage provider.
//
// scrape-screenshot-url.test.ts covers proxy mode over S3. The local provider
// has its own fetch() -- including a path-traversal guard -- and nothing
// exercised it: the fork E2E job runs a single server, and that server uses S3.
// So this file runs under a second harness boot with
// SCREENSHOT_STORAGE_PROVIDER=local (see the "Run local-storage snip" step in
// fork-e2e.yml), and self-skips otherwise.
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
    name: "scrape-screenshot-local",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

const LOCAL_PROXY_MODE =
  process.env.SCREENSHOT_STORAGE_PROVIDER === "local" &&
  process.env.SCREENSHOT_STORAGE_URL_MODE === "proxy";

describeIf(
  TEST_SELF_HOST &&
    HAS_PLAYWRIGHT &&
    ALLOW_TEST_SUITE_WEBSITE &&
    LOCAL_PROXY_MODE,
)("Screenshot proxy over local storage", () => {
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

  it("returns a proxy URL, not a file:// path", () => {
    expect(screenshotUrl).toContain("/v2/screenshot/");
    expect(screenshotUrl.startsWith("file:")).toBe(false);
    expect(screenshotUrl.startsWith("data:")).toBe(false);
  });

  it(
    "reads the image back off disk",
    async () => {
      const res = await fetch(screenshotUrl);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\//);

      const body = Buffer.from(await res.arrayBuffer());
      expect(body.length).toBeGreaterThan(0);
      // PNG magic number -- proves we served the file, not an error page.
      expect(body.subarray(0, 4)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
    },
    scrapeTimeout,
  );

  it(
    "returns 404 for a signed key that does not exist",
    async () => {
      const [prefix] = screenshotUrl.split("/v2/screenshot/");
      const res = await fetch(
        `${prefix}/v2/screenshot/${signKey("no-such-screenshot.png")}`,
      );
      expect(res.status).toBe(404);
    },
    scrapeTimeout,
  );

  // The guard that matters: the key rides inside a signed token, so anyone who
  // could sign could otherwise ask for any file the API process can read. A
  // signature alone must not be enough to escape the storage directory.
  it(
    "refuses to serve a path that escapes the storage directory",
    async () => {
      const [prefix] = screenshotUrl.split("/v2/screenshot/");

      for (const key of [
        "../../../../etc/passwd",
        "../../../../../../etc/hosts",
        "subdir/../../../../etc/passwd",
      ]) {
        const res = await fetch(`${prefix}/v2/screenshot/${signKey(key)}`);
        expect(res.status).toBe(404);
      }
    },
    scrapeTimeout,
  );
});

// Mint a token the server will accept, so these tests probe the storage layer
// rather than the signature check (which scrape-screenshot-url.test.ts covers).
function signKey(key: string): string {
  const secret = process.env.SCREENSHOT_PROXY_SECRET;
  if (!secret) throw new Error("SCREENSHOT_PROXY_SECRET is not set");

  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      key,
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}
