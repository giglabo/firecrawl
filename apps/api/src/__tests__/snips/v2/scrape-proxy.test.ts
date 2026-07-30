import {
  describeIf,
  TEST_SELF_HOST,
  HAS_PLAYWRIGHT,
  TEST_SUITE_WEBSITE,
} from "../lib";
import { scrape, scrapeRaw, scrapeTimeout, idmux, Identity } from "./lib";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-proxy",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

describeIf(TEST_SELF_HOST && HAS_PLAYWRIGHT)("proxyConfig option", () => {
  it.concurrent(
    "scrape without proxyConfig works (uses global or no proxy)",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
        },
        identity,
      );

      expect(response.markdown).toBeDefined();
      expect(response.markdown!.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "rejects proxyConfig with missing server field",
    async () => {
      const response = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          proxyConfig: {} as any,
        },
        identity,
      );

      expect(response.statusCode).toBe(400);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "accepts proxyConfig with valid server",
    async () => {
      // This test validates schema acceptance — the proxy may not be reachable,
      // but the request should not be rejected at the validation layer.
      const response = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          proxyConfig: {
            server: "http://127.0.0.1:1",
          },
        },
        identity,
      );

      // Should not be 400 (validation error) — may fail with scrape error if proxy unreachable
      expect(response.statusCode).not.toBe(400);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "rejects proxyConfig with extra fields (strictObject)",
    async () => {
      const response = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          proxyConfig: {
            server: "http://proxy:8080",
            unknownField: "value",
          } as any,
        },
        identity,
      );

      expect(response.statusCode).toBe(400);
    },
    scrapeTimeout,
  );
});
