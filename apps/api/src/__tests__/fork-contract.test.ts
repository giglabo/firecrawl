import "dotenv/config";

import { config } from "../config";
config.ENV = "test";

import { scrapeOptions } from "../controllers/v2/types";
import { resolveProvider } from "../lib/storage/factory";
import { S3StorageProvider } from "../lib/storage/providers/s3.provider";
import { LocalStorageProvider } from "../lib/storage/providers/local.provider";

/**
 * Contract tests for this fork's additions to upstream's request/response surface.
 *
 * These exist because `scripts/verify-fork-invariants.mjs` is a static check -- it
 * proves our source text is present, not that it still *behaves*. That leaves one
 * class of merge damage uncovered: upstream replacing a schema we extended with a
 * shape that parses differently.
 *
 * Concretely, upstream declares `branding` as an option-less strict object. If that
 * variant lands anywhere in the formats union ahead of ours, every check in the
 * verifier still passes and `tsc` is still happy, but real requests carrying
 * `customScript` / `constants` start getting rejected at validation time. Only
 * actually parsing a request catches that -- and it catches every variant of it
 * (strictObject, looseObject, a rename, a reordered union), not just the one
 * spelling the verifier greps for.
 *
 * Deliberately infrastructure-free: no redis, no browser, no API keys, no network.
 * That is what makes it runnable on every PR, unlike the e2e snips suite.
 */

describe("fork contract: format schemas accept our options", () => {
  it("branding keeps customScript, skipProcessor and constants", () => {
    const parsed = scrapeOptions.parse({
      formats: [
        {
          type: "branding",
          customScript: "return { colors: [] }",
          skipProcessor: true,
          constants: { MIN_LOGO_SIZE: 50, BUTTON_MIN_WIDTH: 80 },
        },
      ],
    });

    const branding = parsed.formats.find(f => f.type === "branding") as any;
    expect(branding).toBeDefined();
    expect(branding.customScript).toBe("return { colors: [] }");
    expect(branding.skipProcessor).toBe(true);
    expect(branding.constants).toEqual({
      MIN_LOGO_SIZE: 50,
      BUTTON_MIN_WIDTH: 80,
    });
  });

  it("dna is a valid format and keeps its options", () => {
    const parsed = scrapeOptions.parse({
      formats: [
        { type: "dna", customScript: "return { dna: {} }", skipProcessor: true },
      ],
    });

    const dna = parsed.formats.find(f => f.type === "dna") as any;
    expect(dna).toBeDefined();
    expect(dna.customScript).toBe("return { dna: {} }");
    expect(dna.skipProcessor).toBe(true);
  });

  it("branding and dna coexist with upstream's formats", () => {
    const parsed = scrapeOptions.parse({
      formats: ["markdown", { type: "branding" }, { type: "dna" }],
    });

    expect(parsed.formats.map(f => f.type).sort()).toEqual([
      "branding",
      "dna",
      "markdown",
    ]);
  });

  it("screenshot keeps our scroll-capture options", () => {
    const parsed = scrapeOptions.parse({
      formats: [
        {
          type: "screenshot",
          fullPage: true,
          scrollCapture: true,
          maxScrollScreenshots: 12,
          scrollWaitMs: 450,
          select: "1,3-5,last",
        },
      ],
    });

    const shot = parsed.formats.find(f => f.type === "screenshot") as any;
    expect(shot.scrollCapture).toBe(true);
    expect(shot.maxScrollScreenshots).toBe(12);
    expect(shot.scrollWaitMs).toBe(450);
    expect(shot.select).toBe("1,3-5,last");
  });
});

describe("fork contract: scrape options", () => {
  it("accepts waitUntil", () => {
    expect(scrapeOptions.parse({ waitUntil: "networkidle" }).waitUntil).toBe(
      "networkidle",
    );
    expect(
      scrapeOptions.parse({ waitUntil: "domcontentloaded" }).waitUntil,
    ).toBe("domcontentloaded");
  });

  it("rejects an unknown waitUntil", () => {
    expect(() => scrapeOptions.parse({ waitUntil: "whenever" })).toThrow();
  });

  it("accepts proxyConfig", () => {
    const parsed = scrapeOptions.parse({
      proxyConfig: {
        server: "http://proxy.local:8080",
        username: "u",
        password: "p",
      },
    });
    expect(parsed.proxyConfig).toEqual({
      server: "http://proxy.local:8080",
      username: "u",
      password: "p",
    });
  });

  it("accepts trackBytesDownloaded and defaults it off", () => {
    expect(scrapeOptions.parse({}).trackBytesDownloaded).toBe(false);
    expect(
      scrapeOptions.parse({ trackBytesDownloaded: true }).trackBytesDownloaded,
    ).toBe(true);
  });

  it("accepts per-request s3 storage", () => {
    const parsed = scrapeOptions.parse({
      storage: {
        provider: "s3",
        prefix: "tenant-a",
        s3: {
          bucket: "shots",
          accessKeyId: "key",
          secretAccessKey: "secret",
          endpoint: "http://minio.local:9000",
          forcePathStyle: true,
        },
      },
    });
    expect(parsed.storage?.provider).toBe("s3");
    expect(parsed.storage?.prefix).toBe("tenant-a");
    expect(parsed.storage?.s3?.bucket).toBe("shots");
  });

  it("accepts per-request local storage", () => {
    const parsed = scrapeOptions.parse({
      storage: { provider: "local", local: { directory: "/var/shots" } },
    });
    expect(parsed.storage?.local?.directory).toBe("/var/shots");
  });

  it("rejects a storage provider with no matching config block", () => {
    // The .refine() that enforces this is easy to lose in a merge: the field
    // still parses, and misconfigured requests silently fall back to data URIs.
    expect(() =>
      scrapeOptions.parse({ storage: { provider: "s3" } }),
    ).toThrow();
    expect(() =>
      scrapeOptions.parse({ storage: { provider: "local" } }),
    ).toThrow();
  });
});

describe("fork contract: storage provider resolution", () => {
  it("per-request s3 config wins over env", () => {
    const provider = resolveProvider({
      provider: "s3",
      s3: {
        bucket: "shots",
        accessKeyId: "key",
        secretAccessKey: "secret",
      } as any,
    });
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });

  it("per-request local config resolves a local provider", () => {
    const provider = resolveProvider({
      provider: "local",
      local: { directory: "/var/shots" } as any,
    });
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });

  it("a per-request provider with no config block resolves to nothing", () => {
    // Must not silently fall through to the env provider -- a tenant asking for
    // their own bucket and getting ours instead is a cross-tenant leak.
    expect(resolveProvider({ provider: "s3" })).toBeNull();
    expect(resolveProvider({ provider: "local" })).toBeNull();
  });
});
