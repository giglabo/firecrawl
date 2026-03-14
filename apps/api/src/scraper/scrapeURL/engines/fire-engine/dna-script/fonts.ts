import { safeStylesheetRules, getStyleSheets, recordError } from "./dom-utils";
import type { FontData } from "./types";

export function extractFonts(): FontData {
  try {
    const fontFaces: FontData["fontFaces"] = [];

    for (const sheet of getStyleSheets()) {
      const rules = safeStylesheetRules(sheet);
      if (!rules) continue;

      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        fontFaces.push({
          family: rule.style.getPropertyValue("font-family").replace(/"/g, ""),
          src: rule.style.getPropertyValue("src").substring(0, 200),
          weight: rule.style.getPropertyValue("font-weight") || "normal",
          display: rule.style.getPropertyValue("font-display") || null,
        });
      }
    }

    const loadedFonts: FontData["loadedFonts"] = [];
    if (document.fonts) {
      document.fonts.forEach(f => {
        loadedFonts.push({
          family: f.family.replace(/"/g, ""),
          weight: f.weight,
          style: f.style,
          status: f.status,
        });
      });
    }

    const hints: FontData["hints"] = Array.from(
      document.querySelectorAll(
        'link[rel="preload"][as="font"], link[rel="preconnect"]',
      ),
    ).map(l => {
      const link = l as HTMLLinkElement;
      return {
        rel: link.rel,
        href: link.href,
        crossOrigin: link.crossOrigin,
      };
    });

    return { fontFaces, loadedFonts, hints };
  } catch (e) {
    recordError("extractFonts", e);
    return { fontFaces: [], loadedFonts: [], hints: [] };
  }
}
