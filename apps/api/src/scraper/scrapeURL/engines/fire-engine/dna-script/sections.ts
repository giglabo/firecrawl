import { getComputedStyleCached, recordError } from "./dom-utils";
import { CONSTANTS } from "./constants";
import type { SectionEntry, ChildSummary } from "./types";

function summarizeChildren(el: Element, depth: number): ChildSummary[] | null {
  if (depth >= CONSTANTS.MAX_SECTION_DEPTH) return null;

  return Array.from(el.children)
    .slice(0, CONSTANTS.MAX_SECTION_CHILDREN)
    .map(child => {
      const cs = getComputedStyleCached(child);
      return {
        tag: child.tagName.toLowerCase(),
        classes: Array.from(child.classList).slice(0, 3),
        display: cs.display,
        gridCols:
          cs.gridTemplateColumns !== "none" ? cs.gridTemplateColumns : null,
        textContent:
          child.children.length === 0 && child.textContent
            ? child.textContent.trim().substring(0, 40)
            : null,
        childCount: child.children.length,
        children:
          child.children.length > 0
            ? summarizeChildren(child, depth + 1)
            : null,
      };
    });
}

export function extractSections(): SectionEntry[] {
  try {
    const sections: SectionEntry[] = [];
    const candidates = document.querySelectorAll(CONSTANTS.SECTION_SELECTOR);
    const elements =
      candidates.length > 2 ? candidates : document.body.children;

    Array.from(elements).forEach(el => {
      const cs = getComputedStyleCached(el);
      const rect = el.getBoundingClientRect();
      if (rect.height < 20) return;

      sections.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList).slice(0, 5),
        layout: {
          display: cs.display,
          flexDirection: cs.flexDirection !== "row" ? cs.flexDirection : null,
          gridTemplateColumns:
            cs.gridTemplateColumns !== "none" ? cs.gridTemplateColumns : null,
          position: cs.position !== "static" ? cs.position : null,
          maxWidth: cs.maxWidth !== "none" ? cs.maxWidth : null,
          gap: cs.gap !== "normal" ? cs.gap : null,
          justifyContent: cs.justifyContent,
          alignItems: cs.alignItems,
        },
        spacing: {
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          marginTop: cs.marginTop,
          marginBottom: cs.marginBottom,
        },
        visual: {
          background: cs.backgroundColor,
          borderBottom:
            cs.borderBottomWidth !== "0px"
              ? cs.borderBottomWidth +
                " " +
                cs.borderBottomStyle +
                " " +
                cs.borderBottomColor
              : null,
          overflow: cs.overflow !== "visible" ? cs.overflow : null,
          zIndex: cs.zIndex !== "auto" ? cs.zIndex : null,
        },
        dimensions: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top + window.scrollY),
        },
        childrenSummary: summarizeChildren(el, 0),
      });
    });

    return sections;
  } catch (e) {
    recordError("extractSections", e);
    return [];
  }
}
