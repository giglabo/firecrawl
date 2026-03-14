import { errors } from "./dom-utils";
import { extractCustomProperties } from "./custom-properties";
import { extractTypography } from "./typography";
import { extractColors } from "./colors";
import { extractSpacing } from "./spacing";
import { extractAnimations } from "./animations";
import { extractSections } from "./sections";
import { extractComponents } from "./components";
import { extractHoverStates } from "./hover-states";
import { extractMediaQueries } from "./media-queries";
import { extractContent } from "./content";
import { extractFonts } from "./fonts";
import { dedupAndTrim } from "./dedup-trim";
import type { DnaResult } from "./types";

export { CONSTANTS } from "./constants";

export const extractDna = (): { dna: ReturnType<typeof dedupAndTrim> } => {
  const raw: DnaResult = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    customProperties: extractCustomProperties(),
    typography: extractTypography(),
    colors: extractColors(),
    spacing: extractSpacing(),
    animations: extractAnimations(),
    sections: extractSections(),
    components: extractComponents(),
    hoverStates: extractHoverStates(),
    mediaQueries: extractMediaQueries(),
    content: extractContent(),
    fonts: extractFonts(),
    errors: errors.length > 0 ? errors : undefined,
  };

  return { dna: dedupAndTrim(raw) };
};

// Auto-execute when loaded in browser context (IIFE pattern)
(function __extractDna() {
  return extractDna();
})();
