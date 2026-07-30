// DNA extraction, exercised against a fixture page we control.
//
// This used to point at https://www.theguardian.com/europe, which made it
// unrunnable in CI (network-dependent and free to change under us) -- commit
// 09e1dedea dropped it from `test:snips:fork` for exactly that reason. It now
// targets apps/test-site/public/dna.html, a static page built to feed every
// DNA module, so the assertions below can pin real values instead of guessing
// at thresholds a news site happened to clear.
//
// The fixture and this file are a pair: if you change one, change the other.
import {
  describeIf,
  TEST_SELF_HOST,
  HAS_PLAYWRIGHT,
  ALLOW_TEST_SUITE_WEBSITE,
  TEST_SUITE_WEBSITE,
} from "../lib";
import { scrapeRaw, scrapeTimeout, idmux, Identity } from "./lib";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-dna",
    concurrency: 100,
    credits: 1000000,
  });
}, 10000 + scrapeTimeout);

// DNA extraction needs a JS-executing engine: fire-engine (chrome-cdp) in
// production, the standalone playwright engine self-hosted.
const CAN_RUN_DNA =
  (!TEST_SELF_HOST || HAS_PLAYWRIGHT) && ALLOW_TEST_SUITE_WEBSITE;

const TEST_URL = `${TEST_SUITE_WEBSITE}/dna.html`;

describeIf(CAN_RUN_DNA)("DNA extraction", () => {
  describe("Happy path — skipProcessor: true", () => {
    let dna: any;

    beforeAll(async () => {
      const raw = await scrapeRaw(
        {
          url: TEST_URL,
          formats: [{ type: "dna", skipProcessor: true } as any],
        },
        identity,
      );

      // Fail loudly. The previous version swallowed a failed scrape and let
      // every assertion below pass vacuously.
      if (raw.statusCode !== 200 || !raw.body.success) {
        throw new Error(
          `DNA scrape failed (${raw.statusCode}): ${JSON.stringify(raw.body).slice(0, 400)}`,
        );
      }
      dna = raw.body.data.dna;
    }, scrapeTimeout);

    it("returns dna field on the document", () => {
      expect(dna).toBeDefined();
      expect(typeof dna).toBe("object");
    });

    // dedupAndTrim() nests these under _meta; the previous version of this test
    // asserted dna.url / dna.timestamp / dna.viewport, which never existed. It
    // went unnoticed because the old guard turned a failed scrape into a silent
    // pass and the file was excluded from CI.
    it("has metadata under _meta (url, timestamp, viewport)", () => {
      expect(dna._meta).toBeDefined();
      expect(typeof dna._meta.url).toBe("string");
      expect(dna._meta.url).toContain("/dna.html");
      expect(typeof dna._meta.timestamp).toBe("string");
      expect(dna._meta.viewport).toBeDefined();
      expect(typeof dna._meta.viewport.width).toBe("number");
      expect(typeof dna._meta.viewport.height).toBe("number");
    });

    it("reports dedup counts for buttons, sections and hover rules", () => {
      expect(dna._meta.dedup).toBeDefined();
      for (const key of ["buttons", "sections", "hoverRules"] as const) {
        expect(typeof dna._meta.dedup[key].raw).toBe("number");
        expect(typeof dna._meta.dedup[key].unique).toBe("number");
        expect(dna._meta.dedup[key].unique).toBeLessThanOrEqual(
          dna._meta.dedup[key].raw,
        );
      }
    });

    // Module 1: Custom properties — fixture declares 20 on :root.
    it("extracts customProperties as an object with --* keys", () => {
      expect(typeof dna.customProperties).toBe("object");
      const keys = Object.keys(dna.customProperties);
      expect(keys.length).toBeGreaterThanOrEqual(20);
      for (const [key, val] of Object.entries(dna.customProperties)) {
        expect(key.startsWith("--")).toBe(true);
        expect((val as any).raw).toBeDefined();
        expect((val as any).resolved).toBeDefined();
      }
    });

    it("resolves specific design tokens from the fixture", () => {
      expect(dna.customProperties["--color-primary"]).toBeDefined();
      expect(dna.customProperties["--color-primary"].resolved).toContain(
        "#1f6feb",
      );
      expect(dna.customProperties["--space-1"].resolved).toContain("8px");
    });

    // Module 2: Typography — h1..h6, p, small, code, figcaption.
    it("extracts typography with full metrics", () => {
      expect(Array.isArray(dna.typography)).toBe(true);
      expect(dna.typography.length).toBeGreaterThan(5);

      const entry = dna.typography[0];
      expect(typeof entry.fontFamily).toBe("string");
      expect(typeof entry.fontSize).toBe("string");
      expect(typeof entry.fontWeight).toBe("string");
      expect(typeof entry.lineHeight).toBe("string");
      expect(typeof entry.count).toBe("number");
    });

    // Module 3: Colors
    it("extracts colors with usage mapping", () => {
      expect(Array.isArray(dna.colors)).toBe(true);
      expect(dna.colors.length).toBeGreaterThan(5);

      const color = dna.colors[0];
      expect(typeof color.hex).toBe("string");
      expect(Array.isArray(color.properties)).toBe(true);
      expect(Array.isArray(color.tags)).toBe(true);
      expect(typeof color.count).toBe("number");

      const withProperties = dna.colors.filter(
        (c: any) => c.properties.length > 0,
      );
      expect(withProperties.length).toBeGreaterThan(0);
    });

    // Module 4: Spacing — the fixture is a strict 8px grid.
    it("extracts spacing with detectedBase (GCD) and frequencyMap", () => {
      expect(dna.spacing).toBeDefined();
      expect(typeof dna.spacing.detectedBase).toBe("number");
      expect(dna.spacing.detectedBase).toBe(8);
      expect(Array.isArray(dna.spacing.frequencyMap)).toBe(true);
      expect(dna.spacing.frequencyMap.length).toBeGreaterThan(3);
      expect(typeof dna.spacing.frequencyMap[0].value).toBe("number");
      expect(typeof dna.spacing.frequencyMap[0].count).toBe("number");
    });

    // Module 5: Animations — two @keyframes, two animated elements.
    it("extracts animations (keyframes + animatedElements)", () => {
      expect(dna.animations).toBeDefined();
      expect(Array.isArray(dna.animations.keyframes)).toBe(true);
      expect(Array.isArray(dna.animations.animatedElements)).toBe(true);
      expect(dna.animations.keyframes.length).toBeGreaterThanOrEqual(2);
      expect(dna.animations.animatedElements.length).toBeGreaterThan(0);
    });

    // Module 6: Sections — six <section> elements plus header/footer.
    it("extracts layout sections with children summaries", () => {
      expect(Array.isArray(dna.sections)).toBe(true);
      expect(dna.sections.length).toBeGreaterThan(3);

      const section = dna.sections[0];
      expect(typeof section.tag).toBe("string");
      expect(section.layout).toBeDefined();
      expect(typeof section.layout.display).toBe("string");
      expect(section.spacing).toBeDefined();
      expect(section.visual).toBeDefined();
      expect(section.dimensions).toBeDefined();

      const withChildren = dna.sections.filter(
        (s: any) => s.childrenSummary && s.childrenSummary.length > 0,
      );
      expect(withChildren.length).toBeGreaterThan(0);
    });

    // Module 7: Components — four buttons, four form controls.
    it("extracts buttons and inputs", () => {
      expect(dna.components).toBeDefined();
      expect(Array.isArray(dna.components.buttons)).toBe(true);
      expect(Array.isArray(dna.components.inputs)).toBe(true);
      expect(dna.components.buttons.length).toBeGreaterThan(0);
      // input[type=text], input[type=email], select, textarea
      expect(dna.components.inputs.length).toBeGreaterThanOrEqual(4);
    });

    // Module 8: Hover states
    it("extracts hover CSS rules", () => {
      expect(Array.isArray(dna.hoverStates)).toBe(true);
      expect(dna.hoverStates.length).toBeGreaterThan(0);
      expect(typeof dna.hoverStates[0].selector).toBe("string");
      expect(typeof dna.hoverStates[0].properties).toBe("object");
    });

    // Module 9: Media queries — fixture declares exactly these, ascending.
    it("extracts responsive breakpoints sorted ascending", () => {
      expect(Array.isArray(dna.mediaQueries)).toBe(true);
      expect(dna.mediaQueries).toEqual([480, 768, 1024, 1280]);
    });

    // Module 10: Content
    it("extracts content metadata, headings, CTAs, navLinks", () => {
      expect(dna.content).toBeDefined();
      expect(dna.content.meta).toBeDefined();
      expect(dna.content.meta.title).toContain("DNA Fixture");
      expect(Array.isArray(dna.content.headings)).toBe(true);
      expect(dna.content.headings.length).toBeGreaterThan(0);
      expect(dna.content.headings[0].text).toContain("Design System Fixture");
      expect(Array.isArray(dna.content.ctas)).toBe(true);
      expect(dna.content.ctas.length).toBeGreaterThan(0);
      expect(Array.isArray(dna.content.navLinks)).toBe(true);
    });

    // Module 11: Fonts — real .woff files, so these actually load.
    it("extracts font faces, loaded fonts, and hints", () => {
      expect(dna.fonts).toBeDefined();
      expect(Array.isArray(dna.fonts.fontFaces)).toBe(true);
      expect(Array.isArray(dna.fonts.loadedFonts)).toBe(true);
      expect(Array.isArray(dna.fonts.hints)).toBe(true);
      expect(dna.fonts.fontFaces.length).toBeGreaterThan(0);
      expect(dna.fonts.loadedFonts.length).toBeGreaterThan(0);
      expect(
        dna.fonts.fontFaces.some((f: any) => f.family.includes("Atkinson")),
      ).toBe(true);
    });

    it("has no extraction errors", () => {
      if (dna.errors) {
        expect(dna.errors).toEqual([]);
      }
    });

    // Gap analysis: a naive GCD over mixed values collapses to 1.
    it("spacing detectedBase is >= 4 (not 1 from naive GCD)", () => {
      expect(dna.spacing.detectedBase).toBeGreaterThanOrEqual(4);
    });

    it("footerText is substantial page-level footer (not a card timestamp)", () => {
      expect(dna.content.footerText).toBeTruthy();
      expect(dna.content.footerText.length).toBeGreaterThan(30);
      expect(dna.content.footerText).toContain("fixture");
    });

    it("navLinks aggregates from all nav elements (deduped)", () => {
      // 6 primary + 6 secondary, all distinct labels.
      expect(dna.content.navLinks.length).toBeGreaterThan(10);
      const texts = dna.content.navLinks.map((l: any) => l.text);
      expect(new Set(texts).size).toBe(texts.length);
    });
  });

  describe("Combined formats", () => {
    it.concurrent(
      "works alongside markdown format",
      async () => {
        const raw = await scrapeRaw(
          {
            url: TEST_URL,
            formats: ["markdown", { type: "dna", skipProcessor: true } as any],
          },
          identity,
        );

        expect(raw.statusCode).toBe(200);
        expect(typeof raw.body.data.markdown).toBe("string");
        expect(typeof raw.body.data.dna).toBe("object");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "works alongside screenshot format",
      async () => {
        const raw = await scrapeRaw(
          {
            url: TEST_URL,
            formats: [
              "screenshot",
              { type: "dna", skipProcessor: true } as any,
            ],
          },
          identity,
        );

        expect(raw.statusCode).toBe(200);
        expect(typeof raw.body.data.screenshot).toBe("string");
        expect(typeof raw.body.data.dna).toBe("object");
      },
      scrapeTimeout,
    );
  });

  describe("Failure path", () => {
    it.concurrent(
      "rejects invalid dna format options",
      async () => {
        const raw = await scrapeRaw(
          {
            url: TEST_URL,
            formats: [{ type: "dna", unknownField: true } as any],
          },
          identity,
        );

        // Zod strips unknown fields, so this succeeds; 422 is also acceptable
        // if the schema is tightened later.
        expect([200, 422]).toContain(raw.statusCode);
      },
      scrapeTimeout,
    );
  });
});
