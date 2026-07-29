# Per-file merge playbook

Companion to `SKILL.md`. Ordered by how much damage a bad resolution does.

Every claim here is enforced by a check in `scripts/verify-fork-invariants.mjs`.
When you learn something new, add the trap here **and** the check there — prose
alone rots, which is exactly how `MERGE-GUIDE.md` became misleading.

---

## Feature → owning files

| Feature | Ours-only files | Files shared with upstream |
|---|---|---|
| DNA extraction | `engines/fire-engine/dna-script/**`, `engines/fire-engine/dnaScript.ts` | `engines/index.ts`, `controllers/v2/types.ts`, `transformers/index.ts`, `engines/fire-engine/index.ts` |
| Scroll screenshots | — | `controllers/v{1,2}/types.ts`, `playwright-service-ts/api.ts`, `engines/playwright/index.ts` |
| Pluggable screenshot storage | `lib/storage/**` | `transformers/uploadScreenshot.ts`, `transformers/index.ts`, `config.ts`, `controllers/v2/types.ts` |
| Standalone playwright scrape path | `engines/playwright/index.ts` | `engines/index.ts` |
| Branding customization (3-layer) | — | `engines/fire-engine/brandingScript.ts`, `config.ts` |
| Cookie-banner dismissal | `playwright-service-ts/helpers/dismiss_cookie_banners.ts` | `playwright-service-ts/api.ts` |
| Configurable `waitUntil` | — | `controllers/v{1,2}/types.ts`, `engines/playwright/index.ts`, `playwright-service-ts/api.ts` |
| Per-request proxy | — | `engines/playwright/index.ts`, `playwright-service-ts/api.ts`, `config.ts` |
| `trackBytesDownloaded` | — | `controllers/v2/types.ts`, `engines/index.ts`, `engines/fire-engine/index.ts` |
| WebP conversion | `native/src/image_converter.rs` | `native/src/lib.rs`, `native/Cargo.toml` |

---

## `apps/api/src/scraper/scrapeURL/engines/index.ts`

The single most important file. Our changes are mechanical but load-bearing.

**Must hold after merge:**

1. `"dna"` in the `featureFlags` array and `dna: { priority: 20 }` in
   `featureFlagOptions`.
2. **Every** block in `engineOptions` has a `dna` key. `engineOptions` is a mapped
   type over `featureFlags`, so a missing key is a `tsc` error — that is the
   safety net. New upstream engines (recent examples: `wikipedia`, `x-twitter`,
   `exchange`) always arrive without it. Rule: `dna: true` only where the engine
   can execute JS (chrome-cdp variants, standalone `playwright`), `dna: false`
   otherwise.
3. The **standalone `playwright` block** keeps five flags that upstream ships as
   `false`, because upstream deliberately disabled that engine and we depend on it:
   ```ts
   screenshot: true, "screenshot@fullScreen": true,
   stealthProxy: true, branding: true, dna: true,
   ```
   Upstream flipping these to `false` does **not** conflict when their value at the
   merge base was already `false` — git sees a one-sided change (ours) and keeps
   it. That is luck, not a guarantee. Verify explicitly.
4. `EngineScrapeResult` keeps `screenshots?: string[]` and
   `bytesDownloaded?: number`.
5. `shouldUseIndex` excludes the `dna` format. Without it, an index cache hit
   returns a document with no DNA payload for a request that asked for DNA.
6. **No `fire-engine;playwright`.** Upstream removed that engine
   (`ebb3e9174`) and we never used it; our tree removed it too. Do not restore it.

**Also check:** `usePlaywright` is still gated only on
`config.PLAYWRIGHT_MICROSERVICE_URL`. If upstream ever adds another condition
there, our whole self-hosted path goes dark while every test still compiles.

---

## `apps/api/src/scraper/scrapeURL/transformers/uploadScreenshot.ts`

**Upstream deleted this file** (it went away with the Supabase SDK in the move to
Drizzle). It is a `UD` conflict, so resolve with `--ours` and then repair by hand:

- Re-add `import { uploadScreenshot } from "./uploadScreenshot";` and the
  `uploadScreenshot` entry in `transformerStack` in `transformers/index.ts`.
- The provider chain must stay: **per-request `storage` → env config → data URI**.

### The Supabase case (a feature we could not keep)

The original upstream implementation fell back to
`supabase_service.storage.from("media")`. Upstream deleted
`apps/api/src/services/supabase.ts` *and* dropped `@supabase/supabase-js` from
`apps/api/package.json` entirely. That fallback is therefore **impossible** to
carry forward, not merely inconvenient — it was removed from our tree ahead of the
merge.

Consequence: with no storage provider configured and `USE_DB_AUTHENTICATION=true`,
screenshots come back as inline data URIs instead of Supabase URLs. Irrelevant for
self-hosted deployments (which configure `SCREENSHOT_STORAGE_PROVIDER`), but it is
a real behavior change — the kind worth stating to the user, not burying.

The invariant `storage/no-static-supabase-import` exists to stop anyone
reintroducing the import from an old copy of the file.

---

## `apps/api/src/controllers/v2/types.ts`

Highest conflict count, lowest severity — almost all of it is two sides appending
to the same union or type. Keep both, with one exception.

**The exception:** upstream defines branding as
`z.strictObject({ type: z.literal("branding") })` — no options. Ours is
`brandingFormatWithOptions` with `customScript`, `skipProcessor`, `constants`.
Both in the union means the first match wins and our options get rejected at
validation time with a confusing error. **Replace theirs with ours.**

Must survive: `brandingFormatWithOptions`, `dnaFormatWithOptions` (both in the
formats union), the `storage` request object and its `.refine()`, `waitUntil`,
`proxyConfig`, `trackBytesDownloaded`, screenshot options (`scrollCapture`,
`maxScrollScreenshots`, `scrollWaitMs`, `select`, `device`), and on `Document`:
`screenshots`, `screenshotPath`, `screenshotPaths`, `dna`.

`controllers/v1/types.ts` is the same story, smaller: `waitUntil`, `proxyConfig`,
`screenshots`.

---

## `apps/api/src/scraper/scrapeURL/transformers/index.ts`

Two independent things to get right:

1. **Adopt upstream's stack order**, then insert ours. Upstream adds and reorders
   transformers freely (`performRedactPII`, `fetchProduct`, `fetchMenu`,
   `performQuery`, `fetchAudio`, `fetchVideo`, `performDeterministicJson`, and
   `performLLMExtractUnlessNativeJson` replacing `performLLMExtract`). Do not
   resolve this by keeping our whole array — you would silently revert their work.
   Take theirs and add `deriveDnaFromActions` (right after
   `deriveBrandingFromActions`) and `uploadScreenshot` (after
   `deriveMetadataFromRawHTML`, before the index senders).
2. `coerceFieldsToFormats` must still prune/validate `document.screenshots` and
   `document.dna` alongside upstream's fields.

`deriveDnaFromActions` and `deriveBrandingFromActions` cooperate: branding runs
first and leaves the `javascriptReturn` entry in place when it contains a `dna`
key, so DNA can find it. Do not "simplify" one without reading the other.

---

## `apps/playwright-service-ts/api.ts`

Most heavily rewritten shared file (upstream: ~+400/-86 since our fork point),
but the hunks are small. Both sides' changes are needed.

**Take all of upstream's security hardening verbatim** — SSRF protection, DNS
resolution + cache, private-IP blocking, `InsecureConnectionError`, request
interception. Never weaken it to make ours fit.

**Keep all of ours:**

- `UrlModel` fields: `execute_javascript`, `screenshot*` (incl.
  `screenshot_scroll_capture`, `screenshot_max_scrolls`, `screenshot_device`),
  `dismiss_cookie_banners`, `wait_until`, `proxy`.
- `createContext(skipTlsVerification, blockMedia, deviceName, proxyConfig)` — if
  upstream changes the signature or return shape, adapt ours onto theirs rather
  than reverting.
- `scrapePage(page, url, waitUntil, ...)` — upstream hardcodes
  `page.goto(url, { waitUntil: 'load' })`. Ours takes it as a parameter. This is
  easy to lose because the diff looks like a harmless revert.
- `captureScrollScreenshots`, the `/devices` endpoint, cookie dismissal via
  `getCookieDismissScript()`, and JS execution.

Ordering inside `/scrape` that matters: validate the URL (upstream's SSRF check)
**first**, then our device validation, then create the context, then navigate,
then cookie dismissal → JS execution → screenshots.

---

## `apps/api/src/config.ts`

Upstream centralized config (`#2496`) and the file roughly doubled, but our env
vars have auto-merged cleanly so far. Confirm all of these are still declared:

`SCREENSHOT_STORAGE_PROVIDER`, `SCREENSHOT_STORAGE_S3_{ENDPOINT,REGION,BUCKET,ACCESS_KEY_ID,SECRET_ACCESS_KEY,FORCE_PATH_STYLE,PUBLIC_URL,PREFIX}`,
`SCREENSHOT_STORAGE_LOCAL_{DIR,PUBLIC_URL}`, `SCREENSHOT_UPLOAD_CONCURRENCY`,
`BRANDING_{CUSTOM_SCRIPT_PATH,CONSTANTS_OVERRIDE,SKIP_LLM,SKIP_PROCESSOR}`,
`DNA_{CUSTOM_SCRIPT_PATH,CONSTANTS_OVERRIDE}`,
`PLAYWRIGHT_PROXY_{BASIC,STEALTH}[_USERNAME,_PASSWORD]`.

---

## `apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts`

Small conflicts. Keep our DNA-script execution alongside branding in
`scrapeURLWithFireEngineChromeCDP`, and our `bytesDownloaded` plumbing. Accept
upstream's removal of the playwright request type and function.

## `apps/api/src/scraper/scrapeURL/engines/fire-engine/brandingScript.ts`

Three override layers, in priority order — all must survive:
per-request `options.customScript` → `config.BRANDING_CUSTOM_SCRIPT_PATH` →
built-in bundle, plus a constants override (`options.constants` →
`config.BRANDING_CONSTANTS_OVERRIDE`). `dnaScript.ts` mirrors this.

## `apps/api/native/`

`Cargo.toml` conflicts because both sides add dependencies — keep both. Ours are
for `image_converter.rs` (`convertImageToWebp`, used by screenshot WebP output);
`lib.rs` must keep the module registration.

## `apps/api/pnpm-lock.yaml`, `apps/api/package.json`

See `SKILL.md` Phase 2 bucket D. Regenerate the lockfile; never resolve its hunks
by hand.

---

## Traps confirmed in the v2.11.153 merge (952 commits, 2026-07)

Each of these cost a debugging round; check them explicitly next time.

1. **Test runner: jest → vitest.** Upstream deleted jest entirely and moved to
   vitest (`vitest.config.ts`, `globals: true`, `include: ["src/**/*.test.ts"]`).
   Our test *sources* need no change (globals cover `describe`/`it`/`expect`),
   but anything that *invokes* jest breaks: `.github/workflows/fork-guard.yml`
   (`jest` → `vitest run <file>`) and the snips harness command
   (`pnpm harness pnpm exec vitest run …`). This is invisible until `jest` is
   physically gone from `node_modules/.bin`.

2. **New engines without `dna`.** This merge added `x-twitter`, `exchange`,
   `wikipedia` — all non-JS content engines, all needing `dna: false`. The
   verifier's `dna-on-every-engine` check catches them; `tsc` also catches them
   via the mapped type. Note `x-twitter` is a *quoted* key (hyphen), the others
   are bare identifiers — grep both.

3. **Native tsc false-positives until you build.** Right after the merge, `tsc`
   in `apps/api` reports dozens of `Cannot find module '@mendable/firecrawl-rs'`
   plus signature errors (`robotsUserAgent`, `PdfProcessResult.logs`, arg counts)
   in *upstream* files. These are **not** merge defects — the checked-in napi
   `.d.ts` is pre-merge. `cd apps/api/native && pnpm install` rebuilds it from the
   merged Rust source and they all clear. Don't "fix" upstream files chasing them.

4. **`@types/node` >= 22 Buffer generics.** The dep bump makes `Buffer` generic,
   so `Buffer.from(...)` infers `Buffer<ArrayBuffer>` while napi returns
   `Buffer<ArrayBufferLike>`. `uploadScreenshot.ts` reassigns one to the other —
   annotate the variable `let buffer: Buffer = …` to widen it. Our-file fix, real
   error, only surfaces once the merged lockfile is installed.

5. **`api.ts` createContext/scrapePage shape change.** Upstream changed
   `createContext` to return `{ context, securityState }` (was just the context)
   and added a `userAgentOverride` param + a local SSRF proxy
   (`http://127.0.0.1:${ssrfProxyPort}`) as the *unconditional* proxy. Reconcile:
   append our params (`blockMedia, deviceName, proxyConfig`) before theirs, keep
   our proxy-resolution chain but make the SSRF proxy the final `else` branch, and
   destructure `{ context, securityState }` at both call sites. `scrapePage` gains
   a `securityState` param and a try/catch that rethrows `InsecureConnectionError`
   — keep it *and* our wider `waitUntil` union.

6. **`transformerStack` auto-merges to upstream's, silently dropping
   `uploadScreenshot`.** It went away with the Supabase removal, so a clean
   auto-merge of that region loses it with no conflict. Re-add the import and the
   stack entry (after `deriveMetadataFromRawHTML`, before the index senders). The
   verifier's transformer checks catch this.

## Runtime coverage: `.github/workflows/fork-e2e.yml`

A fork-owned, secret-free workflow that runs the five fork snips through the
self-hosted playwright path (a trimmed clone of upstream's `Server Test Suite`).
It is the only gate that exercises our features at *runtime*; keep it green.
`idmux` falls back to a test identity when `IDMUX_URL` is unset, and the snips
scrape a local test-site, so no secrets are required. MinIO (a service in the
workflow) backs the `scrape-storage` snip.

Two non-obvious traps in that workflow, both cost a CI round:
- **`pnpm/action-setup` needs an explicit `version:`** — the repo has no root
  `package.json` with a `packageManager` field, so auto-detection fails with
  "No pnpm version is specified". Pin `11.4.0` (matches `apps/api`).
- **The harness only waits for the API when the command is `pnpm test:snips*`.**
  `harness.ts` gates on `command[0] === "pnpm" && command[1].startsWith("test:snips")`.
  Anything else (e.g. `pnpm exec vitest run …`) races the API boot and every
  request is `ECONNREFUSED`. Hence the dedicated `test:snips:fork` script in
  `apps/api/package.json` — keep it, and invoke it as `pnpm harness pnpm test:snips:fork`.
- `bitnami/minio:latest` was pulled from Docker Hub; use `minio/minio` + `minio/mc`
  to create the bucket.
