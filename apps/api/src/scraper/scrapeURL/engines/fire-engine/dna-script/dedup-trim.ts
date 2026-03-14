import { CONSTANTS } from "./constants";
import type {
  DnaResult,
  ButtonEntry,
  SectionEntry,
  HoverRule,
  ChildSummary,
} from "./types";

// --- Deduplication types ---

interface DedupButtonEntry extends ButtonEntry {
  occurrences: number;
}

interface DedupSectionEntry extends SectionEntry {
  occurrences: number;
  isUnique: boolean;
}

interface DedupHoverRule {
  selector: string;
  properties: Record<string, string>;
  matchingSelectors: string[];
  occurrences: number;
}

export interface DedupMeta {
  url: string;
  timestamp: string;
  viewport: { width: number; height: number };
  targetSizeKB: number;
  actualSizeKB: number;
  trimPasses: number;
  dedup: {
    buttons: { raw: number; unique: number };
    sections: { raw: number; unique: number };
    hoverRules: { raw: number; unique: number };
  };
}

export interface DedupDnaResult {
  _meta: DedupMeta;
  customProperties: DnaResult["customProperties"];
  typography: DnaResult["typography"];
  colors: DnaResult["colors"];
  spacing: DnaResult["spacing"];
  animations: DnaResult["animations"];
  sections: DedupSectionEntry[];
  components: {
    buttons: DedupButtonEntry[];
    inputs: DnaResult["components"]["inputs"];
  };
  hoverStates: DedupHoverRule[];
  mediaQueries: DnaResult["mediaQueries"];
  content: DnaResult["content"];
  fonts: DnaResult["fonts"];
  errors?: DnaResult["errors"];
}

// --- Deduplication ---

function dedupButtons(buttons: ButtonEntry[]): DedupButtonEntry[] {
  const seen = new Map<string, DedupButtonEntry>();
  for (const btn of buttons) {
    const key = btn.classes.slice().sort().join(" ");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...btn, occurrences: 1 });
    } else {
      existing.occurrences++;
    }
  }
  return Array.from(seen.values());
}

function sectionKey(s: SectionEntry): string {
  return [
    s.layout.display,
    s.layout.gridTemplateColumns || "none",
    s.childrenSummary?.length || 0,
  ].join("|");
}

function dedupSections(sections: SectionEntry[]): DedupSectionEntry[] {
  const seen = new Map<string, DedupSectionEntry>();
  for (const sec of sections) {
    const key = sectionKey(sec);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...sec, occurrences: 1, isUnique: true });
    } else {
      existing.occurrences++;
      existing.isUnique = false;
    }
  }
  return Array.from(seen.values());
}

function dedupHoverStates(rules: HoverRule[]): DedupHoverRule[] {
  const seen = new Map<string, DedupHoverRule>();
  for (const rule of rules) {
    const key = Object.keys(rule.properties).sort().join(",");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        selector: rule.selector,
        properties: rule.properties,
        matchingSelectors: [rule.selector],
        occurrences: 1,
      });
    } else {
      existing.occurrences++;
      if (existing.matchingSelectors.length < 5) {
        existing.matchingSelectors.push(rule.selector);
      }
    }
  }
  return Array.from(seen.values());
}

// --- Trimming passes ---

function sizeKB(obj: unknown): number {
  return JSON.stringify(obj).length / 1024;
}

function truncateChildrenDepth(
  children: ChildSummary[] | null,
  maxDepth: number,
  currentDepth: number,
): ChildSummary[] | null {
  if (!children) return null;
  if (currentDepth >= maxDepth) return null;
  return children.map(c => ({
    ...c,
    children: truncateChildrenDepth(c.children, maxDepth, currentDepth + 1),
  }));
}

function pass1(result: DedupDnaResult): void {
  // Reduce section children depth to 1
  for (const sec of result.sections) {
    sec.childrenSummary = truncateChildrenDepth(sec.childrenSummary, 1, 0);
  }

  // Filter custom properties to colors/dimensions only if > 100
  const cpEntries = Object.entries(result.customProperties);
  if (cpEntries.length > 100) {
    const filtered: typeof result.customProperties = {};
    for (const [k, v] of cpEntries) {
      if (/[#]|px|rem|em|vh|vw|%/.test(v.resolved)) {
        filtered[k] = v;
      }
    }
    result.customProperties = filtered;
  }

  // Colors: keep top 20
  result.colors = result.colors.slice(0, 20);

  // Animated elements: keep top 20
  if (result.animations.animatedElements.length > 20) {
    result.animations.animatedElements =
      result.animations.animatedElements.slice(0, 20);
  }
}

function pass2(result: DedupDnaResult): void {
  // Truncate fontFamily to first 2 fonts
  for (const t of result.typography) {
    const parts = t.fontFamily.split(",").map(s => s.trim());
    if (parts.length > 2) {
      t.fontFamily = parts.slice(0, 2).join(", ");
    }
  }

  // Truncate long gridTemplateColumns
  for (const sec of result.sections) {
    if (
      sec.layout.gridTemplateColumns &&
      sec.layout.gridTemplateColumns.length > 100
    ) {
      const tracks = sec.layout.gridTemplateColumns.split(" ").length;
      sec.layout.gridTemplateColumns = `complex grid: ${tracks}+ tracks`;
    }
  }

  // Trim content arrays
  if (result.content.headings.length > 20) {
    result.content.headings = result.content.headings.slice(0, 20);
  }
  if (result.content.ctas.length > 20) {
    result.content.ctas = result.content.ctas.slice(0, 20);
  }
  if (result.content.navLinks.length > 15) {
    result.content.navLinks = result.content.navLinks.slice(0, 15);
  }
  if (result.content.footerText && result.content.footerText.length > 150) {
    result.content.footerText = result.content.footerText.substring(0, 150);
  }
}

function pass3(result: DedupDnaResult): void {
  // Drop low-value section fields
  for (const sec of result.sections) {
    delete (sec.dimensions as Record<string, unknown>).top;
    if (sec.visual.overflow === "visible" || sec.visual.overflow === null) {
      delete (sec.visual as Record<string, unknown>).overflow;
    }
    if (sec.visual.zIndex === "auto" || sec.visual.zIndex === null) {
      delete (sec.visual as Record<string, unknown>).zIndex;
    }
  }

  // Drop button low-value fields
  for (const btn of result.components.buttons) {
    delete (btn.styles as Record<string, unknown>).cursor;
    if (btn.styles.position === "static") {
      delete (btn.styles as Record<string, unknown>).position;
    }
  }

  // Drop font face src and hints
  for (const ff of result.fonts.fontFaces) {
    delete (ff as Record<string, unknown>).src;
  }
  delete (result.fonts as unknown as Record<string, unknown>).hints;
}

function pass4(result: DedupDnaResult): void {
  // Aggressive limits
  result.sections = result.sections.slice(0, 10);
  result.hoverStates = result.hoverStates.slice(0, 15);
  result.components.buttons = result.components.buttons.slice(0, 5);
  result.components.inputs = result.components.inputs.slice(0, 3);

  // Custom properties: keep max 50 color/spacing-related
  const cpEntries = Object.entries(result.customProperties);
  if (cpEntries.length > 50) {
    const filtered: typeof result.customProperties = {};
    let count = 0;
    for (const [k, v] of cpEntries) {
      if (count >= 50) break;
      if (/[#]|px|rem|em/.test(v.resolved)) {
        filtered[k] = v;
        count++;
      }
    }
    result.customProperties = filtered;
  }

  // Drop animated elements entirely, keep keyframes
  result.animations.animatedElements = [];
}

function pass5(result: DedupDnaResult): void {
  // Emergency trimming
  for (const sec of result.sections) {
    sec.childrenSummary = null;
  }

  // Drastically reduce everything
  const cpEntries = Object.entries(result.customProperties);
  if (cpEntries.length > 30) {
    result.customProperties = Object.fromEntries(cpEntries.slice(0, 30));
  }

  result.colors = result.colors.slice(0, 8);
  result.typography = result.typography.slice(0, 10);
  result.hoverStates = result.hoverStates.slice(0, 10);

  // Drop content arrays except meta, navLinks, footerText
  result.content.headings = [];
  result.content.ctas = [];
}

// --- Main entry point ---

const passes = [pass1, pass2, pass3, pass4, pass5];

export function dedupAndTrim(raw: DnaResult): DedupDnaResult {
  const targetSizeKB = CONSTANTS.TARGET_SIZE_KB ?? 0;

  const rawButtonCount = raw.components.buttons.length;
  const rawSectionCount = raw.sections.length;
  const rawHoverCount = raw.hoverStates.length;

  const dedupedButtons = dedupButtons(raw.components.buttons);
  const dedupedSections = dedupSections(raw.sections);
  const dedupedHovers = dedupHoverStates(raw.hoverStates);

  const result: DedupDnaResult = {
    _meta: {
      url: raw.url,
      timestamp: raw.timestamp,
      viewport: raw.viewport,
      targetSizeKB,
      actualSizeKB: 0,
      trimPasses: 0,
      dedup: {
        buttons: { raw: rawButtonCount, unique: dedupedButtons.length },
        sections: { raw: rawSectionCount, unique: dedupedSections.length },
        hoverRules: { raw: rawHoverCount, unique: dedupedHovers.length },
      },
    },
    customProperties: raw.customProperties,
    typography: raw.typography,
    colors: raw.colors,
    spacing: raw.spacing,
    animations: raw.animations,
    sections: dedupedSections,
    components: {
      buttons: dedupedButtons,
      inputs: raw.components.inputs,
    },
    hoverStates: dedupedHovers,
    mediaQueries: raw.mediaQueries,
    content: raw.content,
    fonts: raw.fonts,
    errors: raw.errors,
  };

  // If no target, return deduped but untrimmed
  if (targetSizeKB <= 0) {
    result._meta.actualSizeKB = Math.round(sizeKB(result) * 10) / 10;
    return result;
  }

  // Iterative trimming
  for (let i = 0; i < passes.length; i++) {
    const currentSize = sizeKB(result);
    if (currentSize <= targetSizeKB) break;
    passes[i](result);
    result._meta.trimPasses = i + 1;
  }

  result._meta.actualSizeKB = Math.round(sizeKB(result) * 10) / 10;
  return result;
}
