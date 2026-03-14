export const CONSTANTS = {
  TARGET_SIZE_KB: 0 as number, // 0 = unlimited (dedup only, no trimming). Set to e.g. 50 for size-aware output.
  MAX_ELEMENTS_TO_SCAN: 5000,
  MAX_TYPOGRAPHY_ENTRIES: 50,
  MAX_COLOR_ENTRIES: 100,
  MAX_SECTION_DEPTH: 3,
  MAX_SECTION_CHILDREN: 10,
  MAX_HOVER_RULES: 200,
  MAX_ANIMATED_ELEMENTS: 50,
  MAX_KEYFRAMES: 50,
  MAX_CUSTOM_PROPERTIES: 500,
  MAX_BUTTONS: 50,
  MAX_INPUTS: 30,
  MAX_HEADINGS: 50,
  MAX_NAV_LINKS: 50,
  SHADOW_DOM_MAX_DEPTH: 3,
  TEXT_SELECTORS:
    "h1,h2,h3,h4,h5,h6,p,span,a,li,button,label,input,blockquote,figcaption,small,strong,em",
  BUTTON_SELECTOR:
    'button,a.btn,[class*="btn"],[class*="button"],input[type="submit"]',
  SECTION_SELECTOR:
    'header,nav,main,section,footer,[role="banner"],[role="main"],[role="contentinfo"],article',
  CTA_SELECTOR: 'button,a.btn,[class*="btn"],[class*="cta"]',
};
