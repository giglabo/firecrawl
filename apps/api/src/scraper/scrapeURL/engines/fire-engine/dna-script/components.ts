import { getComputedStyleCached, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { ComponentData } from "./types";

export function extractComponents(): ComponentData {
  try {
    const buttons: ComponentData["buttons"] = [];

    document.querySelectorAll(CONSTANTS.BUTTON_SELECTOR).forEach(el => {
      if (buttons.length >= CONSTANTS.MAX_BUTTONS) return;

      const cs = getComputedStyleCached(el);
      const before = getComputedStyle(el, "::before");
      const after = getComputedStyle(el, "::after");

      buttons.push({
        text: (el.textContent || "").trim().substring(0, 30),
        classes: Array.from(el.classList),
        styles: {
          padding: cs.padding,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily.split(",")[0].trim().replace(/"/g, ""),
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
          background: cs.backgroundColor,
          color: cs.color,
          border: cs.border,
          borderRadius: cs.borderRadius,
          transition: cs.transition !== "none" ? cs.transition : "",
          boxShadow: cs.boxShadow !== "none" ? cs.boxShadow : "",
          position: cs.position,
          overflow: cs.overflow,
        },
        pseudoBefore:
          before.content !== "none"
            ? {
                position: before.position,
                background: before.backgroundColor,
                transform: before.transform,
                transformOrigin: before.transformOrigin,
                transition:
                  before.transition !== "none" ? before.transition : "",
                inset: before.inset,
                zIndex: before.zIndex,
              }
            : null,
        pseudoAfter:
          after.content !== "none"
            ? {
                position: after.position,
                background: after.backgroundColor,
                width: after.width,
                height: after.height,
                transition: after.transition !== "none" ? after.transition : "",
              }
            : null,
      });
    });

    const inputs: ComponentData["inputs"] = [];

    document
      .querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]), textarea, select',
      )
      .forEach(el => {
        if (inputs.length >= CONSTANTS.MAX_INPUTS) return;

        const cs = getComputedStyleCached(el);
        const inputEl = el as HTMLInputElement;

        inputs.push({
          type: inputEl.type || el.tagName.toLowerCase(),
          placeholder: inputEl.placeholder || null,
          styles: {
            padding: cs.padding,
            border: cs.border,
            borderRadius: cs.borderRadius,
            background: cs.backgroundColor,
            fontSize: cs.fontSize,
            color: cs.color,
          },
        });
      });

    return { buttons, inputs };
  } catch (e) {
    recordError("extractComponents", e);
    return { buttons: [], inputs: [] };
  }
}
