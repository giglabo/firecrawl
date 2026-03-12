import { getComputedStyleCached, rgbToHex, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { ColorEntry } from "./types";

const COLOR_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
];

export function extractColors(): ColorEntry[] {
  try {
    const colorMap = new Map<
      string,
      { properties: Set<string>; tags: Set<string>; count: number }
    >();

    const allElements = document.querySelectorAll("*");
    const total = allElements.length;
    const step =
      total > CONSTANTS.MAX_ELEMENTS_TO_SCAN
        ? Math.ceil(total / CONSTANTS.MAX_ELEMENTS_TO_SCAN)
        : 1;

    for (let i = 0; i < total; i += step) {
      const el = allElements[i];
      const cs = getComputedStyleCached(el);

      for (const prop of COLOR_PROPS) {
        const val = cs.getPropertyValue(prop);
        if (!val || val === "rgba(0, 0, 0, 0)" || val === "transparent")
          continue;

        const hex = rgbToHex(val).toLowerCase();
        if (!colorMap.has(hex)) {
          colorMap.set(hex, {
            properties: new Set(),
            tags: new Set(),
            count: 0,
          });
        }
        const entry = colorMap.get(hex)!;
        entry.properties.add(prop);
        entry.tags.add(el.tagName.toLowerCase());
        entry.count++;
      }
    }

    return Array.from(colorMap.entries())
      .map(([hex, data]) => ({
        hex,
        properties: Array.from(data.properties),
        tags: Array.from(data.tags).slice(0, 10),
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, CONSTANTS.MAX_COLOR_ENTRIES);
  } catch (e) {
    recordError("extractColors", e);
    return [];
  }
}
