Firecrawl is a web scraper API. The directory you have access to is a monorepo:
 - `apps/api` has the actual API and worker code
 - `apps/*-sdk` are various SDKs

When making changes to the API, here are the general steps you should take:
1. Write some end-to-end tests that assert your win conditions, if they don't already exist
  - 1 happy path (more is encouraged if there are multiple happy paths with significantly different code paths taken)
  - 1+ failure path(s)
  - Generally, E2E (called `snips` in the API) is always preferred over unit testing.
  - In the API, always use `scrapeTimeout` from `./lib` to set the timeout you use for scrapes.
  - These tests will be ran on a variety of configurations. You should gate tests in the following manner:
    - If it requires fire-engine: `!process.env.TEST_SUITE_SELF_HOSTED`
    - If it requires AI: `!process.env.TEST_SUITE_SELF_HOSTED || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL`
2. Write code to achieve your win conditions
3. Run your tests using `pnpm harness pnpm exec vitest run ...` (upstream migrated the test runner from jest to vitest; `vitest.config.ts` sets `globals: true`, so `describe`/`it`/`expect` still work without imports)
  - `pnpm harness` is a command that gets the API server and workers up for you to run the tests. Don't try to `pnpm start` manually.
  - The full test suite takes a long time to run, so you should try to only execute the relevant tests locally, and let CI run the full test suite.
4. Push to a branch, open a PR, and let CI run to verify your win condition.
Keep these steps in mind while building your TODO list.

## Fork relationship

This is a fork of `mendableai/firecrawl` (upstream). Our remote layout:
- `origin` — upstream (`firecrawl/firecrawl`)
- `fork` — our fork (`giglabo/firecrawl`)

**CRITICAL: NEVER create pull requests against `origin` (upstream). All PRs must target `fork` (`giglabo/firecrawl`). Use `gh pr create --repo giglabo/firecrawl` or push to `fork` remote.**

### Our custom features (must survive merges)

We extend upstream with self-hosted branding, DNA extraction, scroll screenshots, pluggable storage, configurable `waitUntil`, and per-request proxy for playwright. All features use **existing upstream API endpoints** (`POST /v1/scrape`, `POST /v2/scrape`) — no new public routes. Changes are additive request/response fields.

**New files (ours, no conflict risk):**
- `apps/api/src/lib/storage/` — pluggable screenshot storage (S3/MinIO, local filesystem)
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/dna-script/` — DNA extraction scripts
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/dnaScript.ts` — DNA script bundler
- `apps/playwright-service-ts/helpers/dismiss_cookie_banners.ts` — cookie banner dismissal
- `apps/api/src/__tests__/snips/v2/scrape-dna.test.ts`, `scrape-storage.test.ts`, `scrape-waituntil.test.ts`, `scrape-proxy.test.ts` — tests
- `docker-compose.selfhost.yaml`, `docker-compose.selfhost-local.yaml`, `selfhost.sh`
- Docs: `SELFHOST.md`, `BRANDING-SCRIPTS.md`, `DNA-SCRIPTS.md`, `SCREENSHOT-STORAGE.md`, `SCROLL-SCREENSHOTS.md`, `CUSTOM_IMAGES.md`

**Modified upstream files (conflict-prone on merge):**
- `apps/api/src/controllers/v2/types.ts` — added `brandingFormatWithOptions`, `dnaFormatWithOptions` schemas, `storage` field, `screenshots[]` and `dna` response fields, `waitUntil` option, `proxyConfig` object
- `apps/api/src/controllers/v1/types.ts` — added `screenshots[]` to Document, `waitUntil` option, `proxyConfig` object
- `apps/api/src/config.ts` — added env vars for storage, branding/DNA script customization, `PLAYWRIGHT_PROXY_*` named proxy mapping
- `apps/api/src/scraper/scrapeURL/engines/index.ts` — added `dna` feature flag to all engines, **enabled `screenshot`, `branding`, `dna`, `stealthProxy` on the standalone `playwright` engine**
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/index.ts` — DNA script execution alongside branding in chrome-cdp
- `apps/api/src/scraper/scrapeURL/engines/fire-engine/brandingScript.ts` — 3-layer override system (per-request → env file → built-in)
- `apps/api/src/scraper/scrapeURL/engines/playwright/index.ts` — JS execution, screenshot params, device emulation, branding/DNA script passing, `waitUntil` smart defaults, `resolvePlaywrightProxy()` with 3-level resolution
- `apps/api/src/scraper/scrapeURL/transformers/index.ts` — `deriveDnaFromActions`, enhanced `deriveBrandingFromActions`, `screenshots`/`dna` in `coerceFieldsToFormats`
- `apps/api/src/scraper/scrapeURL/transformers/uploadScreenshot.ts` — async pluggable storage with provider priority
- `apps/api/src/scraper/scrapeURL/index.ts` — `dna` feature flag, `screenshots` propagation
- `apps/playwright-service-ts/api.ts` — scroll screenshots, cookie dismissal, JS execution, device emulation, configurable `waitUntil` (was hardcoded to `'load'`), per-request proxy via `createContext`

### Merging upstream

Always merge (not rebase) upstream into our branch: `git merge origin/main`.

**Rules when resolving conflicts:**

1. **Keep all our custom features.** Our format schemas (`brandingFormatWithOptions`, `dnaFormatWithOptions`), storage config, scroll screenshot fields, DNA extraction, and `waitUntil` option must survive. If upstream adds new formats/fields, include them alongside ours.

2. **The standalone `playwright` engine is critical for us.** Upstream may disable or strip features from it (they already disabled `fire-engine;playwright` and set standalone playwright features to `false`). Always re-enable our feature flags on the `playwright` engine block:
   ```
   screenshot: true, "screenshot@fullScreen": true, branding: true, dna: true, stealthProxy: true
   ```

3. **We do NOT need `fire-engine;playwright`.** Upstream removed it and we never used it — our self-hosted setup uses the standalone playwright engine directly. Do not restore `fire-engine;playwright` references.

4. **Add `dna` to any new engine option blocks** upstream introduces. Set `dna: true` for engines that support JS execution (chrome-cdp, playwright), `dna: false` for others (tlsclient, fetch, pdf, document, index, etc.).

5. **`playwright-service-ts/api.ts` is the most conflict-prone file.** When merging upstream changes here:
   - Keep upstream's security hardening (SSRF protection, DNS validation)
   - Keep our additions (cookie dismissal, JS execution, scroll screenshots, device emulation, configurable `waitUntil`)
   - If upstream changes `createContext` signature, adapt ours to match while preserving our `blockMedia` and `deviceName` parameters
   - Keep the `wait_until` parameter in the request interface and the `scrapePage` call — upstream hardcodes `'load'`, we make it configurable

6. **`uploadScreenshot.ts` — keep our async pluggable storage.** Upstream deleted this file, so it conflicts as `UD`: resolve with `--ours`, then re-add its import and `transformerStack` entry in `transformers/index.ts`. Preserve the provider resolution chain: per-request config → env config → data URI fallback. (The old Supabase step is gone — upstream deleted both `services/supabase.ts` and the `@supabase/supabase-js` dependency.)

7. **After merge, verify:**
   ```bash
   node scripts/verify-fork-invariants.mjs          # 46 checks; must be 46/46
   # tsc needs the native lib built first, otherwise every `@mendable/firecrawl-rs`
   # import is a false "Cannot find module" error (the napi .d.ts is regenerated
   # by the build). Build it, then typecheck:
   (cd apps/api/native && pnpm install)             # napi build -> regenerates index.d.ts
   (cd apps/api && pnpm install --ignore-scripts && ./node_modules/.bin/tsc --noEmit)
   (cd apps/playwright-service-ts && pnpm install --ignore-scripts && ./node_modules/.bin/tsc --noEmit)
   # e2e for the fork's snips (self-hosted playwright path). CI runs this as the
   # `Fork E2E` workflow (.github/workflows/fork-e2e.yml), which invokes
   # `pnpm test:snips:fork` -- keep that script and this list in sync. Locally
   # the harness only waits for the API when the wrapped command starts with
   # `pnpm test:snips`, so prefer:
   pnpm harness pnpm test:snips:fork
   # Note: Fork E2E deliberately runs with NO rabbitmq service and no
   # NUQ_RABBITMQ_URL, because that is what docker-compose.selfhost.yaml ships.
   # Running the harness by hand reproduces that only if you also set
   # POSTGRES_HOST to a non-"localhost" value -- otherwise harness.ts:823
   # starts its own broker and papers over broker-less bugs. See
   # src/__tests__/snips/v2/scrape-async-queue.test.ts.
   ```

**Use the `merge-upstream` skill** (`.claude/skills/merge-upstream/`) to perform a merge — it derives the current conflict surface rather than describing a fixed one, and `reference/file-playbook.md` holds the per-file rules and known traps. `MERGE-GUIDE.md` is a **historical plan that was never executed** and is ~950 upstream commits stale; do not follow it.

Never bypass `knip` failures (e.g. with `git commit --no-verify`). If the pre-commit `knip` check fails, fix the reported unused exports/files — even if they predate your change — before committing.
