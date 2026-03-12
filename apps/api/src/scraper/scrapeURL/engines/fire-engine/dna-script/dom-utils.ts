export {
  getComputedStyleCached,
  getClassNameString,
  recordError,
  errors,
} from "../branding-script/helpers";

export function safeStylesheetRules(sheet: CSSStyleSheet): CSSRule[] | null {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return null;
  }
}

export function getStyleSheets(): CSSStyleSheet[] {
  return Array.from(document.styleSheets);
}

export function rgbToHex(rgb: string): string {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return rgb;
  return (
    "#" +
    [m[1], m[2], m[3]]
      .map(x => parseInt(x).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function buildSelector(el: Element): string {
  if (el.id) return "#" + el.id;
  const tag = el.tagName.toLowerCase();
  const cn = el.className;
  if (cn && typeof cn === "string") {
    const classes = cn.trim().split(/\s+/).slice(0, 3).join(".");
    return classes ? tag + "." + classes : tag;
  }
  return tag;
}
