import { safeStylesheetRules, getStyleSheets, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { HoverRule } from "./types";

export function extractHoverStates(): HoverRule[] {
  try {
    const hoverRules: HoverRule[] = [];

    for (const sheet of getStyleSheets()) {
      const rules = safeStylesheetRules(sheet);
      if (!rules) continue;

      for (const rule of rules) {
        if (hoverRules.length >= CONSTANTS.MAX_HOVER_RULES) break;
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!rule.selectorText.includes(":hover")) continue;

        const props: Record<string, string> = {};
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          props[p] = rule.style.getPropertyValue(p);
        }
        hoverRules.push({
          selector: rule.selectorText,
          properties: props,
        });
      }
    }

    return hoverRules;
  } catch (e) {
    recordError("extractHoverStates", e);
    return [];
  }
}
