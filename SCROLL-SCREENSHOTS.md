# Scroll-Based Multi-Screenshot Capture

## Overview

The scroll screenshot feature captures multiple viewport-sized screenshots as it scrolls through a page. This solves two problems with traditional full-page screenshots:

1. **Lazy-loaded content** — images and sections below the fold only load when scrolled into view. Scroll capture triggers these loads.
2. **LLM resolution** — vision models (Claude, GPT-4V) process images in fixed-size patches. A single 1280x8000 full-page image gets heavily downsampled, losing detail. Multiple viewport-sized screenshots preserve per-section resolution for component detection and color extraction.

## API Usage

### Via the Firecrawl API (v2)

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "screenshot",
      "scrollCapture": true,
      "maxScrollScreenshots": 10,
      "scrollWaitMs": 500
    }]
  }'
```

**Response** includes both fields for backward compatibility:

```json
{
  "data": {
    "screenshot": "data:image/png;base64,...",
    "screenshots": [
      "data:image/png;base64,...",
      "data:image/png;base64,...",
      "data:image/png;base64,..."
    ]
  }
}
```

- `screenshot` — first viewport screenshot (backward compatible)
- `screenshots` — array of all viewport screenshots, top to bottom

### Screenshot Format Options

| Option                 | Type    | Default | Description                                        |
|------------------------|---------|---------|----------------------------------------------------|
| `type`                 | string  | —       | Must be `"screenshot"`                             |
| `fullPage`             | boolean | `false` | Capture full page as single image (non-scroll)     |
| `format`               | string  | `"png"` | Output format: `"png"`, `"jpeg"`, or `"webp"`     |
| `quality`              | number  | —       | Quality 1–100 for JPEG/WebP. Omit for PNG.         |
| `viewport`             | object  | —       | Custom `{ width, height }` (max 7680x4320)         |
| `scrollCapture`        | boolean | `false` | Enable scroll-based multi-screenshot capture       |
| `maxScrollScreenshots` | number  | `20`    | Max screenshots to capture (1–50)                  |
| `scrollWaitMs`         | number  | `300`   | Milliseconds to wait between scroll positions      |
| `device`               | string  | —       | Playwright device preset name for emulation        |
| `select`               | string  | —       | Select which screenshots to return (see below)     |

### Device Emulation

Use the `device` option to emulate a specific device (viewport, user-agent, scale factor, touch):

```bash
# Mobile screenshot
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "screenshot",
      "device": "iPhone 14",
      "scrollCapture": true,
      "maxScrollScreenshots": 5
    }]
  }'

# Tablet screenshot
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "screenshot",
      "device": "iPad Pro 11"
    }]
  }'
```

#### Popular Device Presets

| Device             | Viewport     | Scale | Mobile |
|--------------------|-------------|-------|--------|
| `iPhone 14`        | 390 x 664   | 3x    | Yes    |
| `iPhone 14 Pro Max`| 430 x 740   | 3x    | Yes    |
| `iPhone SE`        | 320 x 454   | 2x    | Yes    |
| `iPad Pro 11`      | 834 x 1194  | 2x    | Yes    |
| `iPad Mini`        | 768 x 1024  | 2x    | Yes    |
| `Galaxy S9+`       | 320 x 658   | 4.5x  | Yes    |
| `Galaxy S24`       | 384 x 780   | 3x    | Yes    |
| `Galaxy Tab S4`    | 712 x 1138  | 2.25x | Yes    |

Full list available at `GET /devices` on the Playwright service (returns all Playwright device descriptors as JSON), or see [Playwright Device Descriptors](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json).

When `device` is set, the browser context uses the device's user-agent, viewport, device scale factor, and touch/mobile flags. This means the page will render its responsive layout as it would on that device.

> **Note:** `device` overrides `viewport` if both are specified — the device preset's viewport takes precedence during page load. If you also set `viewport`, it will be applied after load specifically for the screenshot.

### Screenshot Format (PNG / JPEG / WebP)

By default screenshots are captured as PNG. Use `format` to choose a different output format:

```bash
# WebP output (lossy, converted from PNG via native Rust module)
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "screenshot",
      "format": "webp",
      "quality": 85
    }]
  }'

# JPEG output (native Playwright support)
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://example.com",
    "formats": [{
      "type": "screenshot",
      "format": "jpeg",
      "quality": 90
    }]
  }'
```

| Format   | How it works                                          | Quality default |
|----------|-------------------------------------------------------|-----------------|
| `png`    | Lossless, captured natively by Playwright             | N/A             |
| `jpeg`   | Lossy, captured natively by Playwright (`type: jpeg`) | 90              |
| `webp`   | Lossy, PNG captured then converted via Rust (`webp` crate) | 90        |

### Screenshot Selection (`select`)

When using `scrollCapture`, use the `select` option to return only specific screenshots from the array:

```bash
# Get only first and last scroll screenshots
curl -X POST http://localhost:3002/v2/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -d '{
    "url": "https://www.theguardian.com",
    "formats": [{
      "type": "screenshot",
      "scrollCapture": true,
      "maxScrollScreenshots": 10,
      "select": "first,last"
    }]
  }'
```

**Syntax** (1-based indices, case-insensitive):

| Value          | Result                         |
|----------------|--------------------------------|
| `"all"`        | All screenshots (default)      |
| `"1"`          | First only                     |
| `"first"`      | Alias for `1`                  |
| `"last"`       | Last only                      |
| `"first,last"` | First and last                 |
| `"1,3,5"`      | Specific indices               |
| `"2-5"`        | Range (inclusive)               |
| `"1,2-5,last"` | Combination                    |

Out-of-range indices are silently ignored.

### Via the Playwright Service Directly

```bash
curl -X POST http://localhost:3000/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "screenshot": true,
    "screenshot_scroll_capture": true,
    "screenshot_max_scrolls": 5,
    "screenshot_scroll_wait": 300,
    "screenshot_device": "iPhone 14"
  }'
```

## How It Works

The Playwright service handles screenshot capture. It also supports `execute_javascript` for branding/DNA script injection (media blocking is auto-disabled when JS execution is requested).

```
page.goto(url)
  → waitAfterLoad
  → checkSelector
  → dismissCookieBanners + 500ms wait (see SELFHOST.md for 3-phase dismissal details)
  → execute_javascript (branding, DNA, etc.)
  → IF scrollCapture:
      1. Force-enable scrolling (override overflow:hidden, remove large fixed overlays)
      2. For each viewport position (0, viewportHeight, 2*viewportHeight, ...):
         a. scrollTo(position)
         b. Wait scrollWaitMs (triggers lazy-load)
         c. Capture viewport screenshot
      3. Scroll back to top
    ELSE IF device (no scroll):
      → screenshot with device viewport
    ELSE:
      → screenshot({ fullPage }) — existing behavior
```

### Scroll Capture Details

- **Overlay removal**: Before scrolling, the function injects `overflow: auto !important` on `html` and `body`, and removes large fixed/sticky overlays (>40% of viewport) that block scrolling — e.g., cookie consent modals.
- **Stuck detection**: If the page doesn't scroll after an attempt (scrollY stays at 0), capture stops early.
- **Position count**: `ceil(scrollHeight / viewportHeight)` positions, capped at `maxScrollScreenshots`.
- **Memory**: 20 PNG screenshots at 1280x800 ≈ 8–15 MB base64 total. Use `quality` (JPEG) to reduce.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Page shorter than viewport | 1 screenshot, equivalent to non-scroll |
| Very long page | Capped at `maxScrollScreenshots` |
| Cookie consent modal blocks scroll | Auto-removed by overlay detection |
| `overflow: hidden` on body | Force-overridden with `!important` |
| Scroll stuck (JS prevention) | Early exit after first failed scroll |
| `scrollCapture: false` (default) | Standard single/fullPage screenshot — no behavior change |

## Storage

When a storage provider is configured (local filesystem, S3, etc.), all screenshots in the `screenshots[]` array are uploaded individually. Each gets a unique key like `screenshots/{scrapeId}-{index}-{uuid}.png`.

See [SCREENSHOT-STORAGE.md](./SCREENSHOT-STORAGE.md) for full details on configuring S3, MinIO, or local filesystem storage providers.

## Files Modified

| File | Change |
|------|--------|
| `apps/playwright-service-ts/api.ts` | Scroll helper, device emulation, `/devices` endpoint |
| `apps/api/src/controllers/v2/types.ts` | `scrollCapture`, `maxScrollScreenshots`, `scrollWaitMs`, `device`, `format`, `select` on screenshot format; `screenshots` on Document |
| `apps/api/src/controllers/v1/types.ts` | `screenshots` on Document |
| `apps/api/src/scraper/scrapeURL/engines/index.ts` | `screenshots` on EngineScrapeResult |
| `apps/api/src/scraper/scrapeURL/engines/playwright/index.ts` | Wire scroll + device params, JPEG format pass-through, parse response |
| `apps/api/src/scraper/scrapeURL/transformers/uploadScreenshot.ts` | Upload screenshots array, WebP conversion, screenshot selection |
| `apps/api/src/scraper/scrapeURL/transformers/index.ts` | Coerce screenshots field |
| `apps/api/src/scraper/scrapeURL/index.ts` | Pass screenshots to document |
| `apps/api/native/src/image_converter.rs` | Rust WebP converter via `webp` crate |
| `apps/api/native/src/lib.rs` | Register image_converter module |
