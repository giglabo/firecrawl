import {
  safeStylesheetRules,
  getStyleSheets,
  buildSelector,
  getComputedStyleCached,
  recordError,
} from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { AnimationData } from "./types";

export function extractAnimations(): AnimationData {
  try {
    const keyframes: AnimationData["keyframes"] = [];

    for (const sheet of getStyleSheets()) {
      const rules = safeStylesheetRules(sheet);
      if (!rules) continue;

      for (const rule of rules) {
        if (keyframes.length >= CONSTANTS.MAX_KEYFRAMES) break;
        if (!(rule instanceof CSSKeyframesRule)) continue;

        const frames: AnimationData["keyframes"][0]["frames"] = [];
        for (const kf of Array.from(rule.cssRules)) {
          const kfRule = kf as CSSKeyframeRule;
          const props: Record<string, string> = {};
          for (let i = 0; i < kfRule.style.length; i++) {
            const p = kfRule.style[i];
            props[p] = kfRule.style.getPropertyValue(p);
          }
          frames.push({ keyText: kfRule.keyText, properties: props });
        }
        keyframes.push({ name: rule.name, frames });
      }
    }

    const animatedElements: AnimationData["animatedElements"] = [];
    const allElements = document.querySelectorAll("*");

    for (let i = 0; i < allElements.length; i++) {
      if (animatedElements.length >= CONSTANTS.MAX_ANIMATED_ELEMENTS) break;
      const el = allElements[i];
      const cs = getComputedStyleCached(el);
      const t = cs.transition;
      const a = cs.animation;

      const hasTransition = t && t !== "all 0s ease 0s" && t !== "none";
      const hasAnimation = a && a !== "none";

      if (hasTransition || hasAnimation) {
        animatedElements.push({
          selector: buildSelector(el),
          transition: t !== "none" ? t : null,
          animation: a !== "none" ? a : null,
          classes: Array.from(el.classList),
        });
      }
    }

    return { keyframes, animatedElements };
  } catch (e) {
    recordError("extractAnimations", e);
    return { keyframes: [], animatedElements: [] };
  }
}
