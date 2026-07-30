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
    name: "scrape-waituntil",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

describeIf(TEST_SELF_HOST && HAS_PLAYWRIGHT)("waitUntil option", () => {
  it.concurrent(
    "text-only scrape works with default (domcontentloaded)",
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
    "screenshot scrape works with default (load)",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["screenshot"],
        },
        identity,
      );

      expect(response.screenshot).toBeDefined();
    },
    scrapeTimeout,
  );

  it.concurrent(
    "explicit waitUntil: domcontentloaded works",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          waitUntil: "domcontentloaded",
        },
        identity,
      );

      expect(response.markdown).toBeDefined();
      expect(response.markdown!.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "explicit waitUntil: load works",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          waitUntil: "load",
        },
        identity,
      );

      expect(response.markdown).toBeDefined();
      expect(response.markdown!.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "explicit waitUntil: networkidle works",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          waitUntil: "networkidle",
        },
        identity,
      );

      expect(response.markdown).toBeDefined();
      expect(response.markdown!.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "rejects invalid waitUntil value",
    async () => {
      const response = await scrapeRaw(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          waitUntil: "invalid" as any,
        },
        identity,
      );

      expect(response.statusCode).toBe(400);
    },
    scrapeTimeout,
  );
});
