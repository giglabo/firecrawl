# DNA Format — Design Token Extraction

The `dna` format extracts comprehensive design tokens and structural metadata from web pages by running a browser-side script. While the `branding` format focuses on brand identity (logos, CTAs), DNA captures the complete design system: typography, colors, spacing, animations, components, and layout structure.

## Architecture Overview

```
getDnaScript(options?)
  -> engine injects script as execute_javascript
  -> browser returns DnaResult
  -> document.dna = DnaResult (raw passthrough, no server-side processing)
```

Unlike branding, DNA has no server-side processor or LLM step — the browser script output is returned directly.

## API Usage

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{ "type": "dna" }]
  }'
```

**Response:**

```json
{
  "data": {
    "dna": {
      "url": "https://example.com",
      "timestamp": "2026-03-11T12:00:00.000Z",
      "viewport": { "width": 1280, "height": 800 },
      "customProperties": { "--primary": { "raw": "var(--blue)", "resolved": "#0066ff" } },
      "typography": [{ "fontFamily": "Inter", "fontSize": "16px", "fontWeight": "400", "lineHeight": "1.5", "letterSpacing": "normal", "textTransform": "none", "color": "#333", "tags": ["p"], "sampleText": "...", "count": 42 }],
      "colors": [{ "hex": "#0066ff", "properties": ["color"], "tags": ["a"], "count": 15 }],
      "spacing": { "detectedBase": 8, "frequencyMap": [] },
      "animations": { "keyframes": [], "animatedElements": [] },
      "sections": [{ "tag": "header", "id": "", "classes": [], "layout": {}, "spacing": {}, "visual": {}, "dimensions": {}, "childrenSummary": [] }],
      "components": { "buttons": [], "inputs": [] },
      "hoverStates": [],
      "mediaQueries": [768, 1024, 1280],
      "content": { "meta": {}, "headings": [], "ctas": [], "navLinks": [], "footerText": "" },
      "fonts": { "fontFaces": [], "loadedFonts": [], "hints": [] }
    }
  }
}
```

## Three Layers of Customization

DNA uses the same three-layer customization system as branding.

### Layer A: Constants Override

Override detection thresholds without replacing the script.

**Env var (deployment-wide):**
```bash
DNA_CONSTANTS_OVERRIDE='{"MAX_ELEMENTS_TO_SCAN": 3000, "MAX_TYPOGRAPHY_ENTRIES": 30}'
```

**Per-request:**
```json
{
  "url": "https://example.com",
  "formats": [{ "type": "dna", "constants": { "MAX_ELEMENTS_TO_SCAN": 3000 } }]
}
```

Per-request constants take precedence over the env var.

#### Available Constants

| Constant | Default | Description |
|---|---|---|
| `MAX_ELEMENTS_TO_SCAN` | 5000 | Max DOM elements to analyze |
| `MAX_TYPOGRAPHY_ENTRIES` | 50 | Max unique typography styles to return |
| `MAX_COLOR_ENTRIES` | 100 | Max unique colors to return |
| `MAX_SECTION_DEPTH` | 3 | Max nesting depth for section analysis |
| `MAX_SECTION_CHILDREN` | 10 | Max children summarized per section |
| `MAX_HOVER_RULES` | 200 | Max CSS hover rules to extract |
| `MAX_ANIMATED_ELEMENTS` | 50 | Max animated elements to report |
| `MAX_KEYFRAMES` | 50 | Max @keyframes definitions to extract |
| `MAX_CUSTOM_PROPERTIES` | 500 | Max CSS custom properties to extract |
| `MAX_BUTTONS` | 50 | Max button components to analyze |
| `MAX_INPUTS` | 30 | Max input components to analyze |
| `MAX_HEADINGS` | 50 | Max headings to extract |
| `MAX_NAV_LINKS` | 50 | Max navigation links to extract |
| `SHADOW_DOM_MAX_DEPTH` | 3 | Max shadow DOM traversal depth |
| `TEXT_SELECTORS` | (see source) | CSS selectors for text elements |
| `BUTTON_SELECTOR` | (see source) | CSS selectors for button detection |
| `SECTION_SELECTOR` | (see source) | CSS selectors for layout sections |
| `CTA_SELECTOR` | (see source) | CSS selectors for CTA elements |

### Layer B: Custom Script File (deployment-level)

Mount a custom `.js` file that replaces the built-in DNA script entirely.

```bash
DNA_CUSTOM_SCRIPT_PATH=/app/custom-dna.js
```

The file should contain raw JavaScript that will be wrapped in an IIFE. It runs in the browser context with full DOM access and must return a `DnaResult`-shaped object.

### Layer C: Per-Request Custom Script

Send inline JavaScript (max 500KB) in the API request.

```json
{
  "url": "https://example.com",
  "formats": [{
    "type": "dna",
    "customScript": "const styles = getComputedStyle(document.body); return { typography: [{ fontFamily: styles.fontFamily }] }"
  }]
}
```

The `customScript` is wrapped in `(function() { ... })();` and executed in the browser.

## DnaResult Type Reference

| Field | Type | Description |
|---|---|---|
| `url` | string | Page URL |
| `timestamp` | string | ISO timestamp of extraction |
| `viewport` | `{ width, height }` | Browser viewport at extraction time |
| `customProperties` | `Record<string, { raw, resolved }>` | CSS custom properties (variables) |
| `typography` | `TypographyEntry[]` | Unique font style combinations with counts |
| `colors` | `ColorEntry[]` | Unique colors with usage context |
| `spacing` | `{ detectedBase, frequencyMap[] }` | Detected spacing system |
| `animations` | `{ keyframes[], animatedElements[] }` | CSS animations and transitions |
| `sections` | `SectionEntry[]` | Page layout structure |
| `components` | `{ buttons[], inputs[] }` | Interactive component styles |
| `hoverStates` | `HoverRule[]` | CSS :hover rule extractions |
| `mediaQueries` | `number[]` | Responsive breakpoints |
| `content` | `{ meta, headings[], ctas[], navLinks[], footerText }` | Content structure metadata |
| `fonts` | `{ fontFaces[], loadedFonts[], hints[] }` | Font loading data |
| `errors` | `Array<{ context, message, timestamp }>` | Non-fatal extraction errors |

## Env Var Reference

| Variable | Type | Description |
|---|---|---|
| `DNA_CUSTOM_SCRIPT_PATH` | string | Path to a custom `.js` file replacing the built-in script |
| `DNA_CONSTANTS_OVERRIDE` | JSON string | Override detection constants (e.g., `{"MAX_ELEMENTS_TO_SCAN": 3000}`) |

## Comparison with Branding

| Aspect | Branding | DNA |
|---|---|---|
| **Focus** | Brand identity (logos, CTAs, brand colors) | Design system (typography, spacing, components) |
| **Post-processing** | `brandingTransformer()` with optional LLM | Raw passthrough (no processor) |
| **LLM usage** | Optional (logo confirmation, button classification) | None |
| **Env prefix** | `BRANDING_*` | `DNA_*` |
| **Customization** | 3 layers (A/B/C) | 3 layers (A/B/C), identical mechanism |

## Files

| File | Purpose |
|---|---|
| `apps/api/src/scraper/scrapeURL/engines/fire-engine/dna-script/` | Browser-side extraction modules |
| `apps/api/src/scraper/scrapeURL/engines/fire-engine/dnaScript.ts` | Script builder (esbuild, caching, layer resolution) |
| `apps/api/src/controllers/v2/types.ts` | `dna` format options and `DnaResult` on Document |
