import { recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { ContentData } from "./types";

export function extractContent(): ContentData {
  try {
    return {
      meta: {
        title: document.title,
        description:
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") || null,
        themeColor:
          document
            .querySelector('meta[name="theme-color"]')
            ?.getAttribute("content") || null,
        lang: document.documentElement.lang || null,
      },
      headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .slice(0, CONSTANTS.MAX_HEADINGS)
        .map(h => ({
          level: h.tagName,
          text: (h.textContent || "").trim().substring(0, 100),
          sectionId: h.closest("section")?.id || h.closest("[id]")?.id || null,
        })),
      ctas: Array.from(document.querySelectorAll(CONSTANTS.CTA_SELECTOR))
        .map(el => (el.textContent || "").trim())
        .filter(t => t.length > 0 && t.length < 40),
      navLinks: (() => {
        // Aggregate links from all nav elements and the first header
        const navEls = Array.from(document.querySelectorAll("nav, header"));
        if (navEls.length === 0) return [];
        const seen = new Set<string>();
        const links: Array<{ text: string; href: string | null }> = [];
        for (const nav of navEls) {
          if (links.length >= CONSTANTS.MAX_NAV_LINKS) break;
          for (const a of Array.from(nav.querySelectorAll("a"))) {
            if (links.length >= CONSTANTS.MAX_NAV_LINKS) break;
            const text = (a.textContent || "").trim();
            const href = a.getAttribute("href");
            if (text.length > 0 && text.length < 50 && !seen.has(text)) {
              seen.add(text);
              links.push({ text, href });
            }
          }
        }
        return links;
      })(),
      footerText: (() => {
        // Grab the last/largest footer (page-level), not a small card footer
        const footers = Array.from(document.querySelectorAll("footer"));
        if (footers.length === 0) return null;
        // Prefer the footer closest to the bottom of the page with substantial content
        const sorted = footers
          .map(f => ({
            el: f,
            rect: f.getBoundingClientRect(),
            textLen: (f.textContent || "").trim().length,
          }))
          .sort((a, b) => {
            // Prefer large footers near the bottom
            const scoreA = a.rect.top + a.textLen;
            const scoreB = b.rect.top + b.textLen;
            return scoreB - scoreA;
          });
        return sorted[0].el.textContent?.trim().substring(0, 300) || null;
      })(),
    };
  } catch (e) {
    recordError("extractContent", e);
    return {
      meta: {
        title: "",
        description: null,
        themeColor: null,
        lang: null,
      },
      headings: [],
      ctas: [],
      navLinks: [],
      footerText: null,
    };
  }
}
