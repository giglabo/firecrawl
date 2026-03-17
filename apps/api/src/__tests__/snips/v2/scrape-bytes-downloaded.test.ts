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
    name: "scrape-bytes-downloaded",
    concurrency: 10,
    credits: 100000,
  });
}, 10000);

describeIf(TEST_SELF_HOST && HAS_PLAYWRIGHT)("trackBytesDownloaded", () => {
  it.concurrent(
    "returns bytesDownloaded in metadata when trackBytesDownloaded is true",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          trackBytesDownloaded: true,
        },
        identity,
      );

      expect(response.metadata).toBeDefined();
      expect(typeof response.metadata.bytesDownloaded).toBe("number");
      expect(response.metadata.bytesDownloaded).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it.concurrent(
    "does not return bytesDownloaded when trackBytesDownloaded is not set",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
        },
        identity,
      );

      expect(response.metadata.bytesDownloaded).toBeUndefined();
    },
    scrapeTimeout,
  );

  it.concurrent(
    "does not return bytesDownloaded when trackBytesDownloaded is false",
    async () => {
      const response = await scrape(
        {
          url: TEST_SUITE_WEBSITE,
          formats: ["markdown"],
          trackBytesDownloaded: false,
        },
        identity,
      );

      expect(response.metadata.bytesDownloaded).toBeUndefined();
    },
    scrapeTimeout,
  );
});
