export interface DnaResult {
  url: string;
  timestamp: string;
  viewport: { width: number; height: number };
  customProperties: Record<string, { raw: string; resolved: string }>;
  typography: TypographyEntry[];
  colors: ColorEntry[];
  spacing: SpacingData;
  animations: AnimationData;
  sections: SectionEntry[];
  components: ComponentData;
  hoverStates: HoverRule[];
  mediaQueries: number[];
  content: ContentData;
  fonts: FontData;
  errors?: Array<{ context: string; message: string; timestamp: number }>;
}

export interface TypographyEntry {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  color: string;
  tags: string[];
  sampleText: string;
  count: number;
}

export interface ColorEntry {
  hex: string;
  properties: string[];
  tags: string[];
  count: number;
}

export interface SpacingData {
  detectedBase: number;
  frequencyMap: Array<{ value: number; count: number }>;
}

export interface AnimationData {
  keyframes: Array<{
    name: string;
    frames: Array<{
      keyText: string;
      properties: Record<string, string>;
    }>;
  }>;
  animatedElements: Array<{
    selector: string;
    transition: string | null;
    animation: string | null;
    classes: string[];
  }>;
}

export interface SectionEntry {
  tag: string;
  id: string | null;
  classes: string[];
  layout: {
    display: string;
    flexDirection: string | null;
    gridTemplateColumns: string | null;
    position: string | null;
    maxWidth: string | null;
    gap: string | null;
    justifyContent: string;
    alignItems: string;
  };
  spacing: {
    paddingTop: string;
    paddingBottom: string;
    marginTop: string;
    marginBottom: string;
  };
  visual: {
    background: string;
    borderBottom: string | null;
    overflow: string | null;
    zIndex: string | null;
  };
  dimensions: { width: number; height: number; top: number };
  childrenSummary: ChildSummary[] | null;
}

export interface ChildSummary {
  tag: string;
  classes: string[];
  display: string;
  gridCols: string | null;
  textContent: string | null;
  childCount: number;
  children: ChildSummary[] | null;
}

export interface ComponentData {
  buttons: ButtonEntry[];
  inputs: InputEntry[];
}

export interface ButtonEntry {
  text: string;
  classes: string[];
  styles: Record<string, string>;
  pseudoBefore: Record<string, string> | null;
  pseudoAfter: Record<string, string> | null;
}

export interface InputEntry {
  type: string;
  placeholder: string | null;
  styles: Record<string, string>;
}

export interface HoverRule {
  selector: string;
  properties: Record<string, string>;
}

export interface ContentData {
  meta: {
    title: string;
    description: string | null;
    themeColor: string | null;
    lang: string | null;
  };
  headings: Array<{
    level: string;
    text: string;
    sectionId: string | null;
  }>;
  ctas: string[];
  navLinks: Array<{ text: string; href: string | null }>;
  footerText: string | null;
}

export interface FontData {
  fontFaces: Array<{
    family: string;
    src: string;
    weight: string;
    display: string | null;
  }>;
  loadedFonts: Array<{
    family: string;
    weight: string;
    style: string;
    status: string;
  }>;
  hints: Array<{
    rel: string;
    href: string;
    crossOrigin: string | null;
  }>;
}
