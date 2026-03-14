import { getComputedStyleCached, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { SpacingData } from "./types";

const SPACING_PROPS = [
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function extractSpacing(): SpacingData {
  try {
    const freq: Record<number, number> = {};

    const allElements = document.querySelectorAll("*");
    const total = allElements.length;
    const step =
      total > CONSTANTS.MAX_ELEMENTS_TO_SCAN
        ? Math.ceil(total / CONSTANTS.MAX_ELEMENTS_TO_SCAN)
        : 1;

    for (let i = 0; i < total; i += step) {
      const cs = getComputedStyleCached(allElements[i]);
      for (const prop of SPACING_PROPS) {
        const val = parseFloat(cs.getPropertyValue(prop));
        if (val > 0 && val < 500) {
          freq[val] = (freq[val] || 0) + 1;
        }
      }
    }

    const topValues = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([v]) => parseFloat(v));

    // Naive GCD across all top values collapses to 1 when values like 8, 10, 4 are mixed.
    // Instead, find the smallest value ≥ 4 that divides the majority (>50%) of top values.
    let base = topValues[0] || 8;
    const candidates = Array.from(new Set(topValues.filter(v => v >= 4))).sort(
      (a, b) => a - b,
    );
    for (const candidate of candidates) {
      const rounded = Math.round(candidate);
      if (rounded < 2) continue;
      const divisible = topValues.filter(
        v => Math.round(v) % rounded === 0,
      ).length;
      if (divisible / topValues.length >= 0.5) {
        base = rounded;
        break;
      }
    }
    // Fallback: if no candidate divides majority, use GCD of top 5
    if (base < 2) {
      base = topValues[0] || 8;
      for (const v of topValues.slice(0, 5)) {
        if (v > 0) base = gcd(Math.round(base), Math.round(v));
      }
      if (base < 2) base = topValues[0] || 8;
    }

    return {
      detectedBase: base,
      frequencyMap: Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([val, count]) => ({ value: parseFloat(val), count })),
    };
  } catch (e) {
    recordError("extractSpacing", e);
    return { detectedBase: 8, frequencyMap: [] };
  }
}
