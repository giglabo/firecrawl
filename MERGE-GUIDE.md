# Merge Guide: Upstream → feat/self-hosted-branding

## Overview

- **Fork point**: `565fc955c`
- **Upstream**: `origin/main` (~35 commits ahead)
- **Our branch**: `feat/self-hosted-branding` (2 commits ahead)
- **New files from us**: ~40 (all merge cleanly — no conflicts)
- **Conflicts**: 4 files

### Upstream notable changes since fork

| Commit | What |
|--------|------|
| `ebb3e9174` | **Removed fire-engine playwright engine** (function + all references) |
| `4baaa1d1a` | **Disabled standalone playwright** engine features |
| `a2de2bc5e` | **SSRF hardening** in playwright-service-ts (DNS validation, IP blocking) |
| `80e8d708f` | **Wikipedia engine** added (new engine type, handler, options) |
| `ae28c3c08` | **Query format** added (`type: "query"` with prompt field) |
| `14c9d2776` | Structured tracing for Rust PDF |

---

## Step 0: Preparation

```bash
# Make sure upstream is fresh
git fetch origin

# Create a safety branch before merging
git checkout feat/self-hosted-branding
git checkout -b feat/self-hosted-branding-pre-merge-backup

# Go back to our branch
git checkout feat/self-hosted-branding

# Start the merge
git merge origin/main
```

Git will report 4 conflicts. Resolve them one by one as described below.

---

## Conflict 1: `apps/api/src/controllers/v2/types.ts`

**Severity**: Low
**What happened**: Upstream added `queryFormatWithOptions` and `answer` field. We added `brandingFormatWithOptions`, `dnaFormatWithOptions`, `storage`, `screenshots`, `dna`.

### Resolution

#### A. Format schemas (around line 400-420)

Keep BOTH our branding/dna schemas AND upstream's query schema. The result should have all three:

```typescript
const brandingFormatWithOptions = z.object({
  type: z.literal("branding"),
  customScript: z.string().max(500_000).optional(),
  skipProcessor: z.boolean().optional(),
  constants: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

type BrandingFormatWithOptions = z.output<typeof brandingFormatWithOptions>;

const dnaFormatWithOptions = z.object({
  type: z.literal("dna"),
  customScript: z.string().max(500_000).optional(),
  skipProcessor: z.boolean().optional(),
  constants: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

type DnaFormatWithOptions = z.output<typeof dnaFormatWithOptions>;

// FROM UPSTREAM:
const queryFormatWithOptions = z.object({
  type: z.literal("query"),
  prompt: z.string(),
});

type QueryFormatWithOptions = z.output<typeof queryFormatWithOptions>;
```

#### B. FormatObject union type

Include all format types:

```typescript
export type FormatObject =
  | { type: "markdown" }
  | { type: "html" }
  | { type: "rawHtml" }
  | { type: "links" }
  | { type: "extract" }
  | { type: "summary" }
  | { type: "json" }
  | ChangeTrackingFormatWithOptions
  | ScreenshotFormatWithOptions
  | AttributesFormatWithOptions
  | BrandingFormatWithOptions      // ours (was plain object)
  | DnaFormatWithOptions           // ours (new)
  | QueryFormatWithOptions;        // upstream (new)
```

#### C. baseScrapeOptions formats array

Include all discriminated union members:

```typescript
.discriminatedUnion("type", [
  // ... existing entries ...
  changeTrackingFormatWithOptions,
  screenshotFormatWithOptions,
  attributesFormatWithOptions,
  brandingFormatWithOptions,       // ours
  dnaFormatWithOptions,            // ours
  queryFormatWithOptions,          // upstream
])
```

#### D. Document type

Keep all fields from both sides:

```typescript
export type Document = {
  // ... existing fields ...
  screenshot?: string;
  screenshots?: string[];    // ours
  extract?: any;
  json?: any;
  summary?: string;
  answer?: string;           // upstream
  branding?: BrandingProfile;
  dna?: any;                 // ours
  warning?: string;
  // ...
};
```

#### E. Storage config and refine

Keep our `storage` field and its `.refine()` validation entirely — upstream didn't touch this area.

#### F. Screenshot format options

Keep our additions (`scrollCapture`, `maxScrollScreenshots`, `scrollWaitMs`, `device`) — upstream didn't change `screenshotFormatWithOptions`.

---

## Conflict 2: `apps/api/src/scraper/scrapeURL/engines/index.ts`

**Severity**: Medium
**What happened**: Upstream removed `fire-engine;playwright` engine entirely and added `wikipedia` engine. We added `dna` feature flag everywhere and enabled features on the standalone `playwright` engine.

### Resolution

#### A. Imports

Keep our imports AND add upstream's Wikipedia:

```typescript
import {
  fireEngineMaxReasonableTime,
  scrapeURLWithFireEngineChromeCDP,
  // NOTE: upstream removed scrapeURLWithFireEnginePlaywright — we keep it
  scrapeURLWithFireEnginePlaywright,
  scrapeURLWithFireEngineTLSClient,
} from "./fire-engine";
// ... existing imports ...
// FROM UPSTREAM:
import {
  scrapeURLWithWikipedia,
  wikipediaMaxReasonableTime,
  isWikimediaUrl,
} from "./wikipedia";
```

> **Decision point**: Upstream removed `scrapeURLWithFireEnginePlaywright`. In self-hosted mode we don't use fire-engine at all, so this import will fail if the function no longer exists in fire-engine/index.ts. Two options:
> 1. **Keep it** if we also keep the function in `fire-engine/index.ts` (see Conflict 4 below)
> 2. **Remove it** and rely only on standalone `playwright` engine (simpler, fewer divergences)
>
> **Recommendation**: Remove `fire-engine;playwright` references. Our self-hosted setup uses the standalone `playwright` engine (which we've enhanced). This reduces divergence from upstream and simplifies future merges.

#### B. Engine union type

If following the recommendation (drop fire-engine;playwright):

```typescript
export type Engine =
  | "fire-engine;chrome-cdp"
  | "fire-engine(retry);chrome-cdp"
  | "fire-engine;chrome-cdp;stealth"
  | "fire-engine(retry);chrome-cdp;stealth"
  // "fire-engine;playwright" — REMOVED (upstream + our decision)
  | "fire-engine;tlsclient"
  | "fire-engine;tlsclient;stealth"
  | "playwright"
  | "fetch"
  | "pdf"
  | "document"
  | "index"
  | "index;documents"
  | "wikipedia";             // upstream
```

#### C. Feature flags

Add our `dna` flag (upstream doesn't have it, but it's purely additive):

```typescript
const featureFlags = [
  // ... existing ...
  "branding",
  "dna",                     // ours
  "disableAdblock",
] as const;
```

And in `featureFlagOptions`:

```typescript
branding: { priority: 20 },
dna: { priority: 20 },      // ours
disableAdblock: { priority: 10 },
```

#### D. Engine availability array

```typescript
const engines: Engine[] = [
  ...(useWikipedia ? ["wikipedia" as const] : []),  // upstream
  ...(useIndex ? ["index" as const, "index;documents" as const] : []),
  ...(useFireEngine
    ? [
        "fire-engine;chrome-cdp" as const,
        "fire-engine;chrome-cdp;stealth" as const,
        "fire-engine(retry);chrome-cdp" as const,
        "fire-engine(retry);chrome-cdp;stealth" as const,
        // fire-engine;playwright REMOVED
        "fire-engine;tlsclient" as const,
        "fire-engine;tlsclient;stealth" as const,
      ]
    : []),
  ...(usePlaywright ? ["playwright" as const] : []),
  "fetch" as const,
  "pdf" as const,
  "document" as const,
];
```

#### E. engineHandlers map

Remove fire-engine;playwright entries, add Wikipedia:

```typescript
const engineHandlers = {
  // ... fire-engine;chrome-cdp entries (keep) ...
  // fire-engine;playwright entries — REMOVE
  "fire-engine;tlsclient": scrapeURLWithFireEngineTLSClient,
  "fire-engine;tlsclient;stealth": scrapeURLWithFireEngineTLSClient,
  playwright: scrapeURLWithPlaywright,
  fetch: scrapeURLWithFetch,
  pdf: scrapePDF,
  document: scrapeDocument,
  wikipedia: scrapeURLWithWikipedia,    // upstream
};
```

#### F. engineMRTs map

Same pattern — remove fire-engine;playwright, add Wikipedia:

```typescript
// Remove these two:
// "fire-engine;playwright": meta => fireEngineMaxReasonableTime(meta, "playwright"),
// "fire-engine;playwright;stealth": meta => fireEngineMaxReasonableTime(meta, "playwright"),

// Add:
wikipedia: wikipediaMaxReasonableTime,
```

#### G. engineOptions — all engine blocks

For every engine block, add our `dna` field. The pattern:

```typescript
// For engines that support JS execution (chrome-cdp, playwright):
dna: true,

// For engines that don't (tlsclient, fetch, pdf, document, index):
dna: false,
```

Remove the two `fire-engine;playwright` and `fire-engine;playwright;stealth` option blocks entirely (upstream already did this).

**Standalone playwright block** — this is critical. Keep our enhanced version:

```typescript
playwright: {
  features: {
    actions: false,
    waitFor: true,
    screenshot: true,                    // ours: was false upstream
    "screenshot@fullScreen": true,       // ours: was false upstream
    pdf: false,
    document: false,
    atsv: false,
    location: false,
    mobile: false,
    skipTlsVerification: true,
    useFastMode: false,
    stealthProxy: false,
    branding: true,                      // ours: was false upstream
    dna: true,                           // ours: new
    disableAdblock: false,
  },
  quality: 20,
},
```

Add upstream's Wikipedia engine block:

```typescript
wikipedia: {
  features: {
    actions: false,
    waitFor: false,
    screenshot: false,
    "screenshot@fullScreen": false,
    pdf: false,
    document: false,
    atsv: false,
    location: false,
    mobile: false,
    skipTlsVerification: true,
    useFastMode: true,
    stealthProxy: false,
    branding: false,
    dna: false,                          // ours: add this field
    disableAdblock: true,
  },
  quality: 500,
},
```

#### H. EngineScrapeResult type

Keep our addition:

```typescript
export type EngineScrapeResult = {
  // ...
  screenshot?: string;
  screenshots?: string[];    // ours
  // ...
};
```

#### I. shouldUseIndex

Keep our check:

```typescript
!hasFormatOfType(meta.options.formats, "branding") &&
!hasFormatOfType(meta.options.formats, "dna") &&    // ours
```

#### J. buildFallbackList

Remove `fire-engine;playwright` from mock list (matches upstream). Add upstream's Wikipedia filtering:

```typescript
// In the mock fallback list, remove "fire-engine;playwright"

// Add upstream's Wikipedia URL check:
if (!isWikimediaUrl(meta.url)) {
  const wikiIndex = _engines.indexOf("wikipedia");
  if (wikiIndex !== -1) {
    _engines.splice(wikiIndex, 1);
  }
}
```

---

## Conflict 3: `apps/api/src/scraper/scrapeURL/transformers/index.ts`

**Severity**: Low
**What happened**: Upstream made minor changes (added `answer` field handling). We added branding/DNA transformers.

### Resolution

Keep all our changes. Additionally integrate upstream's changes:

- In `coerceFieldsToFormats`, upstream added handling for `answer` field (tied to query format). Add it alongside our `dna` handling.
- Keep our `deriveBrandingFromActions` and `deriveDnaFromActions` in the transformer stack.

---

## Conflict 4: `apps/playwright-service-ts/api.ts`

**Severity**: High — most complex conflict
**What happened**: Upstream added comprehensive SSRF protection. We added cookie dismissal, JS execution, scroll screenshots, device emulation.

### Resolution strategy

Both sets of changes are needed and must be interleaved carefully.

#### A. Imports (top of file)

Merge both:

```typescript
import express, { Request, Response } from 'express';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page, devices } from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import { getError } from './helpers/get_error';
import { getCookieDismissScript } from './helpers/dismiss_cookie_banners';  // ours
import { lookup } from 'dns/promises';    // upstream
import IPAddr from 'ipaddr.js';           // upstream
```

#### B. Config constants

Merge both:

```typescript
const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const DISMISS_COOKIE_BANNERS = (process.env.DISMISS_COOKIE_BANNERS ?? 'TRUE').toUpperCase() === 'TRUE';  // ours
const COOKIE_DISMISS_SCRIPT = getCookieDismissScript();  // ours
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10);
const ALLOW_LOCAL_WEBHOOKS = (process.env.ALLOW_LOCAL_WEBHOOKS || 'False').toUpperCase() === 'TRUE';  // upstream
const DNS_CACHE_TTL_MS = 30_000;  // upstream
```

#### C. SSRF protection classes/functions

Take ALL of upstream's SSRF code verbatim. This includes:
- `InsecureConnectionError` class
- `normalizeHostname`, `isHttpProtocol`, `isIPPrivate`, `isLocalHostname`
- `lookupWithCache` with DNS cache
- `validateUrl` async function
- `dnsLookupCache` Map
- `ContextSecurityState` type

#### D. UrlModel interface

Merge both — upstream didn't add fields here, we did:

```typescript
interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
  // OURS:
  execute_javascript?: string;
  screenshot?: boolean;
  screenshot_full_page?: boolean;
  screenshot_quality?: number;
  screenshot_viewport?: { width: number; height: number };
  screenshot_scroll_capture?: boolean;
  screenshot_scroll_wait?: number;
  screenshot_max_scrolls?: number;
  screenshot_device?: string;
  dismiss_cookie_banners?: boolean;
}
```

#### E. createContext function

This is the trickiest part. Upstream changed the return type to `{ context, securityState }` and added request interception for SSRF. We added device emulation and blockMedia parameter.

**Merge both**:

```typescript
const createContext = async (
  skipTlsVerification: boolean = false,
  blockMedia: boolean = BLOCK_MEDIA,      // ours
  deviceName?: string,                     // ours
): Promise<{ context: BrowserContext; securityState: ContextSecurityState }> => {  // upstream return type
  // OUR device emulation logic:
  const deviceDescriptor = deviceName ? devices[deviceName] : undefined;
  const userAgent = deviceDescriptor?.userAgent ?? new UserAgent().toString();
  const viewport = deviceDescriptor?.viewport ?? { width: 1280, height: 800 };

  const securityState: ContextSecurityState = { blocked: [] };  // upstream

  const contextOptions: any = {
    userAgent,
    viewport,
    ignoreHTTPSErrors: skipTlsVerification,
    // OUR device fields:
    ...(deviceDescriptor ? {
      screen: (deviceDescriptor as any).screen,
      deviceScaleFactor: deviceDescriptor.deviceScaleFactor,
      isMobile: deviceDescriptor.isMobile,
      hasTouch: deviceDescriptor.hasTouch,
    } : {}),
  };

  // ... proxy config (unchanged) ...

  const newContext = await browser.newContext(contextOptions);

  // UPSTREAM: SSRF request interception
  await newContext.route('**/*', async (route: Route, request: PlaywrightRequest) => {
    const requestUrl = request.url();
    try {
      const parsed = new URL(requestUrl);
      // ... upstream's full SSRF validation logic ...
    } catch (err) {
      // ... upstream's error handling ...
    }
  });

  // OUR media blocking (keep, but after SSRF route):
  if (blockMedia) {
    await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route) => {
      await route.abort();
    });
  }

  return { context: newContext, securityState };  // upstream return shape
};
```

#### F. scrapePage function

Update to accept and pass `securityState` (upstream change):

```typescript
const scrapePage = async (
  page: Page,
  url: string,
  waitAfterLoad: number,
  timeout: number,
  checkSelector?: string,
  securityState?: ContextSecurityState,   // upstream
) => {
  // ... existing logic ...

  // UPSTREAM: check if page was SSRF-blocked after navigation
  if (securityState?.blocked.some(b => normalizeHostname(new URL(b.url).hostname) === normalizeHostname(new URL(url).hostname))) {
    throw new InsecureConnectionError(url, 'URL resolved to a private/internal IP address');
  }

  // ... rest of function ...
};
```

#### G. captureScrollScreenshots function

Keep our function entirely (upstream doesn't have it). Place it before the scrape endpoint.

#### H. `/devices` endpoint

Keep our endpoint entirely (upstream doesn't have it).

#### I. POST `/scrape` endpoint

This is where both sides made significant changes. The flow should be:

```typescript
app.post('/scrape', async (req: Request, res: Response) => {
  // 1. Destructure — OURS (extended) + upstream's basic fields
  const {
    url,
    wait_after_load = 0,
    timeout = 15000,
    headers,
    check_selector,
    skip_tls_verification = false,
    // OURS:
    execute_javascript,
    screenshot: screenshot_requested,
    screenshot_full_page,
    screenshot_quality,
    screenshot_viewport,
    screenshot_scroll_capture,
    screenshot_scroll_wait,
    screenshot_max_scrolls,
    screenshot_device,
    dismiss_cookie_banners = true,
  }: UrlModel = req.body;

  // ... logging (keep existing) ...

  // 2. UPSTREAM: SSRF validation FIRST (before anything else)
  try {
    await validateUrl(url);
  } catch (err) {
    if (err instanceof InsecureConnectionError) {
      return res.status(403).json({
        error: `Blocked insecure URL: ${err.message}`,
      });
    }
    throw err;
  }

  // 3. OUR device validation
  if (screenshot_device && !devices[screenshot_device]) {
    return res.status(400).json({
      error: `Unknown device "${screenshot_device}".`,
    });
  }

  if (!browser) {
    await initializeBrowser();
  }

  await pageSemaphore.acquire();
  let requestContext: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // 4. Create context — merged signature
    const shouldBlockMedia = execute_javascript ? false : BLOCK_MEDIA;
    const { context, securityState } = await createContext(
      skip_tls_verification,
      shouldBlockMedia,        // ours
      screenshot_device,       // ours
    );
    requestContext = context;
    page = await requestContext.newPage();

    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    // 5. Navigate — pass securityState (upstream)
    const result = await scrapePage(page, url, wait_after_load, timeout, check_selector, securityState);

    // 6. OUR cookie dismissal
    const shouldDismissCookies = dismiss_cookie_banners && DISMISS_COOKIE_BANNERS;
    if (shouldDismissCookies) {
      try {
        const dismissResult = await page.evaluate(COOKIE_DISMISS_SCRIPT);
        if (dismissResult?.dismissed) {
          console.log(`Cookie banner dismissed via: ${dismissResult.method}`);
        }
        await page.waitForTimeout(500);
      } catch (error) {
        console.error('Cookie dismissal error (non-fatal):', error);
      }
    }

    // 7. OUR JavaScript execution
    let javascriptReturn: string | undefined;
    if (execute_javascript) {
      try {
        const jsResult = await page.evaluate(execute_javascript);
        javascriptReturn = JSON.stringify({ type: typeof jsResult, value: jsResult });
      } catch (error) {
        console.error('JavaScript execution error:', error);
      }
    }

    // 8. OUR screenshot capture
    let screenshotData: string | undefined;
    let screenshotsData: string[] | undefined;
    // ... keep all our screenshot logic (scroll capture + single capture) ...

    // 9. Response
    res.json({
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(pageError && { pageError }),
      ...(javascriptReturn !== undefined && { javascriptReturn }),
      ...(screenshotData !== undefined && { screenshot: screenshotData }),
      ...(screenshotsData !== undefined && { screenshots: screenshotsData }),
    });

  } catch (error) {
    // UPSTREAM: handle InsecureConnectionError specifically
    if (error instanceof InsecureConnectionError) {
      return res.status(403).json({
        content: '',
        pageStatusCode: 403,
        pageError: error.message,
      });
    }
    // ... existing error handling ...
  } finally {
    // ... cleanup (unchanged) ...
  }
});
```

---

## Non-conflicting file: `apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts`

**No git conflict** (auto-merges), but review needed.

Upstream removed `scrapeURLWithFireEnginePlaywright` function and `FireEngineScrapeRequestPlaywright` import. Our branch added DNA script handling alongside branding.

**If we dropped `fire-engine;playwright` from engines/index.ts** (recommended above):
- Accept upstream's removal of the function
- Keep our DNA/branding additions to `scrapeURLWithFireEngineChromeCDP` (these auto-merge fine)

**If we kept `fire-engine;playwright`**:
- We'd need to restore the deleted function, which creates ongoing maintenance burden

---

## Post-merge checklist

After resolving all conflicts:

```bash
# 1. Verify TypeScript compiles
cd apps/api && npx tsc --noEmit

# 2. Verify playwright service compiles
cd apps/playwright-service-ts && npx tsc --noEmit

# 3. Run our tests
cd apps/api && pnpm harness jest -- --testPathPattern="scrape-dna|scrape-storage"

# 4. Check that upstream's new Wikipedia engine didn't break anything
#    (should be fine — it's behind a config flag)

# 5. Verify the standalone playwright engine works with branding/dna/screenshots
#    Run a manual test scrape with formats: ["branding", "dna", { type: "screenshot", scrollCapture: true }]

# 6. Commit the merge
git add -A
git commit
```

---

## Ongoing divergence to track

These are intentional differences from upstream that will need attention on future merges:

| Area | Our change | Upstream direction |
|------|-----------|-------------------|
| Playwright engine features | `screenshot: true`, `branding: true`, `dna: true` | `screenshot: false`, `branding: false` (disabled) |
| DNA format | New format type | Does not exist upstream |
| Storage providers | S3/local pluggable storage | Supabase-only |
| Cookie banner dismissal | New helper in playwright-service | Does not exist upstream |
| Scroll screenshots | New feature in playwright-service | Does not exist upstream |
| Branding script customization | 3-layer override system | Single built-in script |

On each future upstream merge, check if upstream:
1. Further modifies the playwright engine block in `engines/index.ts`
2. Changes the `createContext` or scrape endpoint in `playwright-service-ts/api.ts`
3. Modifies the branding script or transformer pipeline
