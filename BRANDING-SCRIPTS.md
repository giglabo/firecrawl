# Customizable Branding Scripts

Firecrawl's branding extraction pipeline runs a JavaScript bundle in the browser to detect brand design tokens (colors, logos, typography, etc.). This document explains how to customize or replace that script.

## Architecture Overview

```
getBrandingScript(options?)
  -> engine injects script as execute_javascript
  -> browser returns result (wrapped in { branding: ... } for built-in script)
  -> deriveBrandingFromActions() extracts the JS return
  -> brandingTransformer() processes raw data (+ optional LLM)
  -> document.branding = BrandingProfile
```

## Three Layers of Customization

### Layer A: Constants Override

Override detection thresholds without replacing the script. Available via env var (deployment-wide) or per-request.

**Env var (deployment-wide):**
```bash
BRANDING_CONSTANTS_OVERRIDE='{"MIN_LOGO_SIZE": 50, "BUTTON_MIN_WIDTH": 80}'
```

**Per-request:**
```json
{
  "url": "https://example.com",
  "formats": [{ "type": "branding", "constants": { "MIN_LOGO_SIZE": 50 } }]
}
```

Per-request constants take precedence over the env var.

#### Available Constants

| Constant | Default | Description |
|---|---|---|
| `BUTTON_MIN_WIDTH` | 50 | Min width (px) for button detection |
| `BUTTON_MIN_HEIGHT` | 25 | Min height (px) for button detection |
| `BUTTON_MIN_PADDING_VERTICAL` | 3 | Min vertical padding (px) for button detection |
| `BUTTON_MIN_PADDING_HORIZONTAL` | 6 | Min horizontal padding (px) for button detection |
| `MAX_PARENT_TRAVERSAL` | 5 | Max DOM levels to traverse upward |
| `MAX_BACKGROUND_SAMPLES` | 100 | Max elements to sample for background colors |
| `MIN_SIGNIFICANT_AREA` | 1000 | Min area (px^2) for significant elements |
| `MIN_LARGE_CONTAINER_AREA` | 10000 | Min area (px^2) for large containers |
| `DUPLICATE_POSITION_THRESHOLD` | 1 | Distance (px) to consider positions duplicated |
| `MIN_LOGO_SIZE` | 25 | Min dimension (px) for logo candidates |
| `MIN_ALPHA_THRESHOLD` | 0.1 | Min alpha for visible colors |
| `MAX_TRANSPARENT_ALPHA` | 0.01 | Max alpha to consider transparent |
| `TASKBAR_TOP_THRESHOLD` | 80 | Max top position (px) for taskbar detection |
| `CONTAINER_TOP_THRESHOLD` | 50 | Max top position (px) for header containers |
| `TASKBAR_LOGO_MAX_TOP` | 120 | Max top (px) for logos in taskbar area |
| `TASKBAR_LOGO_MAX_LEFT` | 450 | Max left (px) for logos in taskbar area |
| `TASKBAR_LOGO_MIN_WIDTH` | 24 | Min width (px) for taskbar logos |
| `TASKBAR_LOGO_MIN_HEIGHT` | 12 | Min height (px) for taskbar logos |
| `TOP_PAGE_THRESHOLD_PX` | 500 | Max Y position (px) for "above the fold" |
| `BUTTON_SELECTOR` | (see source) | CSS selector for button detection |
| `BUTTON_CLASS_PATTERN` | (see source) | Regex for button-like CSS classes |

### Layer B: Custom Script File (deployment-level)

Mount a custom `.js` file that replaces the built-in branding script entirely.

```bash
BRANDING_CUSTOM_SCRIPT_PATH=/app/custom-branding.js
```

The file should contain raw JavaScript that will be wrapped in an IIFE. It runs in the browser context with full DOM access.

**If you want the built-in processor** (`brandingTransformer`) to work, your script must return:
```javascript
return {
  branding: {
    cssData: { /* ... */ },
    snapshots: [ /* ... */ ],
    images: [ /* ... */ ],
    logoCandidates: [ /* ... */ ],
    brandName: "...",
    pageTitle: "...",
    pageUrl: "...",
    typography: { /* ... */ },
    frameworkHints: [],
    colorScheme: "light" | "dark",
    pageBackground: "#fff",
    backgroundCandidates: [ /* ... */ ],
  }
};
```

**If you use `skipProcessor`**, you can return any structure. See Layer C below.

### Layer C: Per-Request Custom Script + Processor Bypass

Send inline JavaScript in the API request. Combine with `skipProcessor` to get raw output.

```json
{
  "url": "https://example.com",
  "formats": [{
    "type": "branding",
    "skipProcessor": true,
    "customScript": "return { colors: [window.getComputedStyle(document.body).backgroundColor] }"
  }]
}
```

The `customScript` is wrapped in `(function() { ... })();` and executed in the browser. The return value is placed directly into `document.branding`.

## Processor Bypass

The `skipProcessor` option skips the server-side `processRawBranding()` + LLM step and returns the raw browser output directly.

**Per-request:**
```json
{ "type": "branding", "skipProcessor": true }
```

**Deployment-wide (env var):**
```bash
BRANDING_SKIP_PROCESSOR=true
```

This is useful for:
- Custom scripts that return non-standard output
- Debugging: seeing the raw data before server-side processing
- Performance: skipping the LLM call when you only need raw data

## Env Var Reference

| Variable | Type | Description |
|---|---|---|
| `BRANDING_CUSTOM_SCRIPT_PATH` | string | Path to a custom `.js` file replacing the built-in script |
| `BRANDING_CONSTANTS_OVERRIDE` | JSON string | Override detection constants (e.g., `{"MIN_LOGO_SIZE": 50}`) |
| `BRANDING_SKIP_PROCESSOR` | boolean | Skip `processRawBranding()`, return raw output |
| `BRANDING_SKIP_LLM` | boolean | Skip the LLM step; use heuristic logo selection (confidence >= 0.3) and skip button classification. Output includes `__llm_metadata` with skip reasons. |
| `DEBUG_BRANDING` | boolean | Enable branding debug logging; preserves raw snapshots (`__button_snapshots`, etc.) in output |

## Examples

### Minimal custom script: extract only colors and logo

```javascript
// custom-branding.js
const body = document.body;
const style = window.getComputedStyle(body);
const bgColor = style.backgroundColor;

const logos = [];
document.querySelectorAll('img[src*="logo"], [class*="logo"] img, header img').forEach(img => {
  if (img.naturalWidth > 20 && img.naturalHeight > 20) {
    logos.push({ src: img.src, width: img.naturalWidth, height: img.naturalHeight });
  }
});

return {
  branding: {
    colors: [bgColor],
    logos,
  }
};
```

Use with `BRANDING_SKIP_PROCESSOR=true` since this doesn't match the full `BrandingScriptReturn` contract.

### Constants override for stricter logo detection

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "branding",
      "constants": {
        "MIN_LOGO_SIZE": 50,
        "TASKBAR_LOGO_MIN_WIDTH": 40,
        "TASKBAR_LOGO_MIN_HEIGHT": 20
      }
    }]
  }'
```
