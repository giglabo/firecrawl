import { getComputedStyleCached, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { TypographyEntry } from "./types";

export function extractTypography(): TypographyEntry[] {
  try {
    const seen = new Map<string, TypographyEntry>();

    document.querySelectorAll(CONSTANTS.TEXT_SELECTORS).forEach(el => {
      const cs = getComputedStyleCached(el);
      const sig = [
        cs.fontFamily.split(",")[0].trim().replace(/"/g, ""),
        cs.fontSize,
        cs.fontWeight,
        cs.lineHeight,
        cs.letterSpacing,
        cs.textTransform,
      ].join("|");

      if (!seen.has(sig)) {
        seen.set(sig, {
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
          color: cs.color,
          tags: [],
          sampleText: "",
          count: 0,
        });
      }

      const entry = seen.get(sig)!;
      entry.count++;
      const tag = el.tagName.toLowerCase();
      if (!entry.tags.includes(tag)) entry.tags.push(tag);
      if (
        !entry.sampleText &&
        el.textContent &&
        el.textContent.trim().length > 0
      )
        entry.sampleText = el.textContent.trim().substring(0, 60);
    });

    return Array.from(seen.values())
      .sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize))
      .slice(0, CONSTANTS.MAX_TYPOGRAPHY_ENTRIES);
  } catch (e) {
    recordError("extractTypography", e);
    return [];
  }
}
