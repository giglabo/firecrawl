import { safeStylesheetRules, getStyleSheets, recordError } from "./dom-utils";

export function extractMediaQueries(): number[] {
  try {
    const bp = new Set<number>();

    for (const sheet of getStyleSheets()) {
      const rules = safeStylesheetRules(sheet);
      if (!rules) continue;

      for (const rule of rules) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const matches = rule.conditionText.match(/(\d+)px/g);
        if (matches) {
          matches.forEach(v => bp.add(parseInt(v)));
        }
      }
    }

    return Array.from(bp).sort((a, b) => a - b);
  } catch (e) {
    recordError("extractMediaQueries", e);
    return [];
  }
}
