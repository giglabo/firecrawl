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
});
