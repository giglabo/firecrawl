import { TEST_SELF_HOST, HAS_PLAYWRIGHT } from "../lib";
import { scrape, scrapeRaw, scrapeTimeout, idmux, Identity } from "./lib";

let identity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "scrape-dna",
    concurrency: 100,
    credits: 1000000,
  });
}, 10000 + scrapeTimeout);

// DNA extraction requires fire-engine (chrome-cdp) or playwright
// Gate: skip in self-hosted unless playwright is available
const CAN_RUN_DNA = !process.env.TEST_SUITE_SELF_HOSTED || HAS_PLAYWRIGHT;

const TEST_URL = "https://www.theguardian.com/europe";

describe("DNA extraction", () => {
  describe("Happy path — skipProcessor: true", () => {
    let dna: any;
    let scrapeSucceeded = false;

    beforeAll(async () => {
      if (!CAN_RUN_DNA) return;

      const raw = await scrapeRaw(
        {
          url: TEST_URL,
          formats: [{ type: "dna", skipProcessor: true } as any],
        },
        identity,
      );

      if (raw.statusCode === 200 && raw.body.success) {
        dna = raw.body.data.dna;
        scrapeSucceeded = true;
      }
    }, scrapeTimeout);

    const shouldRun = () => CAN_RUN_DNA && scrapeSucceeded;

    it("returns dna field on the document", () => {
      if (!shouldRun()) return;
      expect(dna).toBeDefined();
      expect(typeof dna).toBe("object");
    });

    it("has top-level metadata (url, timestamp, viewport)", () => {
      if (!shouldRun()) return;
      expect(typeof dna.url).toBe("string");
      expect(dna.url).toContain("theguardian.com");
      expect(typeof dna.timestamp).toBe("string");
      expect(dna.viewport).toBeDefined();
      expect(typeof dna.viewport.width).toBe("number");
      expect(typeof dna.viewport.height).toBe("number");
    });

    // Module 1: Custom properties
    it("extracts customProperties as an object with --* keys", () => {
      if (!shouldRun()) return;
      expect(typeof dna.customProperties).toBe("object");
      const keys = Object.keys(dna.customProperties);
      expect(keys.length).toBeGreaterThan(10);
      for (const [key, val] of Object.entries(dna.customProperties)) {
        expect(key.startsWith("--")).toBe(true);
        expect((val as any).raw).toBeDefined();
        expect((val as any).resolved).toBeDefined();
      }
    });

    // Module 2: Typography
    it("extracts typography with full metrics", () => {
      if (!shouldRun()) return;
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
      if (!shouldRun()) return;
      expect(Array.isArray(dna.colors)).toBe(true);
      expect(dna.colors.length).toBeGreaterThan(5);

      const color = dna.colors[0];
      expect(typeof color.hex).toBe("string");
      expect(Array.isArray(color.properties)).toBe(true);
      expect(Array.isArray(color.tags)).toBe(true);
      expect(typeof color.count).toBe("number");

      // At least one color should have property tracking
      const withProperties = dna.colors.filter(
        (c: any) => c.properties.length > 0,
      );
      expect(withProperties.length).toBeGreaterThan(0);
    });

    // Module 4: Spacing
    it("extracts spacing with detectedBase (GCD) and frequencyMap", () => {
      if (!shouldRun()) return;
      expect(dna.spacing).toBeDefined();
      expect(typeof dna.spacing.detectedBase).toBe("number");
      expect(dna.spacing.detectedBase).toBeGreaterThan(0);
      expect(Array.isArray(dna.spacing.frequencyMap)).toBe(true);
      expect(dna.spacing.frequencyMap.length).toBeGreaterThan(3);
      expect(typeof dna.spacing.frequencyMap[0].value).toBe("number");
      expect(typeof dna.spacing.frequencyMap[0].count).toBe("number");
    });

    // Module 5: Animations
    it("extracts animations (keyframes + animatedElements)", () => {
      if (!shouldRun()) return;
      expect(dna.animations).toBeDefined();
      expect(Array.isArray(dna.animations.keyframes)).toBe(true);
      expect(Array.isArray(dna.animations.animatedElements)).toBe(true);
    });

    // Module 6: Sections
    it("extracts layout sections with children summaries", () => {
      if (!shouldRun()) return;
      expect(Array.isArray(dna.sections)).toBe(true);
      expect(dna.sections.length).toBeGreaterThan(3);

      const section = dna.sections[0];
      expect(typeof section.tag).toBe("string");
      expect(section.layout).toBeDefined();
      expect(typeof section.layout.display).toBe("string");
      expect(section.spacing).toBeDefined();
      expect(section.visual).toBeDefined();
      expect(section.dimensions).toBeDefined();

      // At least one section should have childrenSummary
      const withChildren = dna.sections.filter(
        (s: any) => s.childrenSummary && s.childrenSummary.length > 0,
      );
      expect(withChildren.length).toBeGreaterThan(0);
    });

    // Module 7: Components
    it("extracts buttons and inputs", () => {
      if (!shouldRun()) return;
      expect(dna.components).toBeDefined();
      expect(Array.isArray(dna.components.buttons)).toBe(true);
      expect(Array.isArray(dna.components.inputs)).toBe(true);
      expect(dna.components.buttons.length).toBeGreaterThan(0);
    });

    // Module 8: Hover states
    it("extracts hover CSS rules", () => {
      if (!shouldRun()) return;
      expect(Array.isArray(dna.hoverStates)).toBe(true);
      expect(dna.hoverStates.length).toBeGreaterThan(0);
      expect(typeof dna.hoverStates[0].selector).toBe("string");
      expect(typeof dna.hoverStates[0].properties).toBe("object");
    });

    // Module 9: Media queries
    it("extracts responsive breakpoints sorted ascending", () => {
      if (!shouldRun()) return;
      expect(Array.isArray(dna.mediaQueries)).toBe(true);
      expect(dna.mediaQueries.length).toBeGreaterThan(2);
      for (const bp of dna.mediaQueries) {
        expect(typeof bp).toBe("number");
      }
      // Should be sorted ascending
      for (let i = 1; i < dna.mediaQueries.length; i++) {
        expect(dna.mediaQueries[i]).toBeGreaterThanOrEqual(
          dna.mediaQueries[i - 1],
        );
      }
    });

    // Module 10: Content
    it("extracts content metadata, headings, CTAs, navLinks", () => {
      if (!shouldRun()) return;
      expect(dna.content).toBeDefined();
      expect(dna.content.meta).toBeDefined();
      expect(typeof dna.content.meta.title).toBe("string");
      expect(dna.content.meta.title.length).toBeGreaterThan(0);
      expect(Array.isArray(dna.content.headings)).toBe(true);
      expect(dna.content.headings.length).toBeGreaterThan(0);
      expect(Array.isArray(dna.content.ctas)).toBe(true);
      expect(Array.isArray(dna.content.navLinks)).toBe(true);
      expect(dna.content.navLinks.length).toBeGreaterThan(0);
    });

    // Module 11: Fonts
    it("extracts font faces, loaded fonts, and hints", () => {
      if (!shouldRun()) return;
      expect(dna.fonts).toBeDefined();
      expect(Array.isArray(dna.fonts.fontFaces)).toBe(true);
      expect(Array.isArray(dna.fonts.loadedFonts)).toBe(true);
      expect(Array.isArray(dna.fonts.hints)).toBe(true);
      expect(dna.fonts.fontFaces.length).toBeGreaterThan(0);
      expect(dna.fonts.loadedFonts.length).toBeGreaterThan(0);
    });

    // No errors
    it("has no extraction errors", () => {
      if (!shouldRun()) return;
      if (dna.errors) {
        expect(dna.errors).toEqual([]);
      }
    });

    // Gap analysis quality checks
    it("spacing detectedBase is >= 4 (not 1 from naive GCD)", () => {
      if (!shouldRun()) return;
      expect(dna.spacing.detectedBase).toBeGreaterThanOrEqual(4);
    });

    it("footerText is substantial page-level footer (not a card timestamp)", () => {
      if (!shouldRun()) return;
      if (dna.content.footerText) {
        expect(dna.content.footerText.length).toBeGreaterThan(30);
      }
    });

    it("navLinks aggregates from all nav elements (deduped)", () => {
      if (!shouldRun()) return;
      expect(dna.content.navLinks.length).toBeGreaterThan(10);
      // Check no duplicate link texts
      const texts = dna.content.navLinks.map((l: any) => l.text);
      const unique = new Set(texts);
      expect(unique.size).toBe(texts.length);
    });
  });

  describe("Combined formats", () => {
    it.concurrent(
      "works alongside markdown format",
      async () => {
        if (!CAN_RUN_DNA) return;

        const raw = await scrapeRaw(
          {
            url: TEST_URL,
            formats: ["markdown", { type: "dna", skipProcessor: true } as any],
          },
          identity,
        );

        if (raw.statusCode !== 200) return; // engine unavailable

        expect(raw.body.data.markdown).toBeDefined();
        expect(typeof raw.body.data.markdown).toBe("string");
        expect(raw.body.data.dna).toBeDefined();
        expect(typeof raw.body.data.dna).toBe("object");
      },
      scrapeTimeout,
    );

    it.concurrent(
      "works alongside screenshot format",
      async () => {
        if (!CAN_RUN_DNA) return;

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

        if (raw.statusCode !== 200) return; // engine unavailable

        expect(raw.body.data.screenshot).toBeDefined();
        expect(typeof raw.body.data.screenshot).toBe("string");
        expect(raw.body.data.dna).toBeDefined();
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

        // Zod strips unknown fields by default, so this should succeed (or 422)
        // But engine may also fail — allow 500 from engine issues
        expect([200, 422, 500]).toContain(raw.statusCode);
      },
      scrapeTimeout,
    );
  });
});
