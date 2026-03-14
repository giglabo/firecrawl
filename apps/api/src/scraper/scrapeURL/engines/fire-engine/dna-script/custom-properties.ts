import { safeStylesheetRules, getStyleSheets, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";

export function extractCustomProperties(): Record<
  string,
  { raw: string; resolved: string }
> {
  const props: Record<string, { raw: string; resolved: string }> = {};
  let count = 0;

  try {
    const rootStyle = getComputedStyle(document.documentElement);

    for (const sheet of getStyleSheets()) {
      const rules = safeStylesheetRules(sheet);
      if (!rules) continue;

      for (const rule of rules) {
        if (count >= CONSTANTS.MAX_CUSTOM_PROPERTIES) break;
        if (!(rule instanceof CSSStyleRule)) continue;
        if (rule.selectorText !== ":root" && rule.selectorText !== "html")
          continue;

        for (let i = 0; i < rule.style.length; i++) {
          if (count >= CONSTANTS.MAX_CUSTOM_PROPERTIES) break;
          const name = rule.style[i];
          if (!name.startsWith("--")) continue;

          const raw = rule.style.getPropertyValue(name).trim();
          const resolved = rootStyle.getPropertyValue(name).trim();
          props[name] = { raw, resolved };
          count++;
        }
      }
    }
  } catch (e) {
    recordError("extractCustomProperties", e);
  }

  return props;
}
