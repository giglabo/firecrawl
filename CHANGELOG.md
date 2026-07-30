# Changelog

All notable changes to **this fork** (`giglabo/firecrawl`) are documented here. The
fork ships an independent `0.x` image line to `ghcr.io/giglabo/*`; see `RELEASING.md`.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Tests
- Proxy mode over the **local** storage provider is now covered (#10). Its `fetch()` and
  path-traversal guard had never executed anywhere: Fork E2E runs one server and that
  server uses S3. Covered by a second harness boot with `SCREENSHOT_STORAGE_PROVIDER=local`
  (~30s, since deps and browsers are already installed). The guard is pinned by an
  invariant — the object key travels inside the signed token, so without it a valid
  signature would be enough to read any file the API process can open.

## [0.5.2] — 2026-07-30

Screenshot URLs that can actually be fetched, plus a large CI speedup.

### Added
- **`SCREENSHOT_STORAGE_URL_MODE`** (#9) selects how a screenshot URL is produced:

  | mode | URL | bucket | expires |
  |---|---|---|---|
  | `public` (default) | bare object URL | must be world-readable | never |
  | `signed` | presigned S3 GET | private | `SCREENSHOT_STORAGE_S3_SIGNED_URL_TTL`, default 1h, clamped to the SigV4 max of 7d |
  | `proxy` | `GET /v2/screenshot/:token` | private | `SCREENSHOT_PROXY_URL_TTL`, default 7d, `0` = permanent |

  The default is unchanged, so existing public-bucket setups keep permanent URLs.
- Per-request `storage.s3` accepts `signedUrls`, `signedUrlTtlSeconds` and
  `signingEndpoint`, for callers bringing their own bucket.

### Fixed
- **Screenshot URLs returned 403.** The code assumed a world-readable bucket — an
  assumption inherited from the Supabase implementation upstream deleted, which returned
  `/storage/v1/object/public/...` from a bucket configured public. The fork replaced it
  with pluggable S3/local storage and carried the assumption over, but not the public
  bucket. Uploads succeeded; every fetch of the returned URL failed.

### Route (deliberate exception)
- `GET /v2/screenshot/:token` is the fork's **first new public route** — everything else
  rides existing upstream endpoints as additive fields. Signed mode needs no route; proxy
  mode does. Documented in `CLAUDE.md` and pinned by invariants, so an upstream merge that
  rewrites `routes/v2.ts` cannot drop it silently.
- The token is `base64url(JSON) + "." + base64url(HMAC-SHA256)` — the same wire format as
  upstream's `PARSE_UPLOAD_REF_SECRET` refs — and its payload carries `exp`, like
  upstream's `ParseUploadRefPayload.expiresAt` and our watchword proxy signer. The route
  is unauthenticated for the same reason `/parse/upload/:uploadId` is: the signature is
  the credential. It authorises exactly one object and carries no team identity.
- Signature is verified **before** expiry, so only a genuinely signed token can produce
  `410 Gone`; malformed, mis-signed and unknown are a flat `404`.
- Proxy mode applies only to the **env-configured** provider. A per-request `storage`
  block keeps its own URL, because the route resolves storage from env and would otherwise
  sign a key for one bucket and read it from another.

### CI / tooling
- **arm64 images build on native runners** instead of QEMU (#7). The arm64 leg ran on an
  amd64 runner under emulation and was essentially the whole release: **68 min → ~8 min**.
  Note it is skipped on `pull_request`, so that leg is first exercised at tag push; verify
  changes to it with a manual `workflow_dispatch` on `main`, which republishes only
  `:latest`.
- **The DNA snip runs in CI again** (#8), against `apps/test-site/public/dna.html`, a
  fixture built to feed every DNA module. It had pointed at a live news site and was
  dropped from `test:snips:fork`; it had also been asserting `dna.url` / `dna.timestamp` /
  `dna.viewport`, which `dedupAndTrim()` nests under `_meta` — assertions that could never
  hold, kept green by a guard that turned a failed scrape into a silent pass.
- Screenshot tests now **fetch** the URL instead of asserting it looks like one. That gap
  is precisely why the 403 shipped. Presigned tests run against a deliberately private
  MinIO bucket, with a control assertion that its unsigned URL is refused — against the
  public bucket a broken signer would still return 200.
- Fork invariants: 46 → 53.

### Deployment
- Deployed as `0.5.2` with `SCREENSHOT_STORAGE_URL_MODE=proxy` and an in-cluster
  `SCREENSHOT_PROXY_BASE_URL`. The S3 bucket stays **private**; no public access was
  granted. Bump `firecrawl` and `playwright-service` together — `playwright-service-ts/api.ts`
  diverged substantially across 0.4.0 → 0.5.x.

## [0.5.1] — 2026-07-30

### Fixed
- **Async jobs never ran** (`/v2/batch/scrape`, `/v1/crawl` hung forever while sync
  `/v2/scrape` worked). `nuq-prefetch-worker` polls Postgres every 250ms and claims queued
  jobs with `UPDATE ... SET status='active'`, then hands them to RabbitMQ. With
  `NUQ_RABBITMQ_URL` empty the hand-off silently dropped them while the row stayed
  `active`, and `getJobToProcess()` only ever selects `queued` — invisible to every worker
  until the lock reaper released it a minute later, at which point prefetch reclaimed it.
  A livelock. Sync scrape was unaffected because it runs inline via `skipNuq`.
- The fix skips prefetching entirely when there is no broker: the harness does not start
  the worker, and `prefetchJobs()` returns early for deployments that run it directly.

### Note on the 0.5.0 deployment note
The "Deployment note" in 0.5.0 below is accurate about Redis/Postgres/RabbitMQ but
describes the wrong cause for what was actually broken. Redis was alive the whole time;
RabbitMQ was never required. The hang was the prefetch livelock above. Nothing caught it
because `test-server.yml` and the fork's own `fork-e2e.yml` both started a real rabbitmq
service, so the broker-less configuration shipped in `docker-compose.selfhost.yaml` was
exercised nowhere. Fork E2E now runs with **no** broker.

> Reproducing it locally has a trap: `harness.ts` starts its own RabbitMQ container when
> `POSTGRES_HOST` is `localhost`, which papers over the bug. Set a non-localhost
> `POSTGRES_HOST` *and* export an empty `NUQ_RABBITMQ_URL` — `unset` is not enough, `.env`
> refills it.

## [0.5.0] — 2026-07-30

The large upstream catch-up merge, with the fork's custom layer preserved and a real
CI safety net around it.

### Merged
- **952-commit upstream merge** of `firecrawl/firecrawl` `main` (as of 2026-07-29) into
  the fork. Merge commit `b1c2671`. Notable upstream changes absorbed: Supabase→Drizzle
  (screenshot-upload Supabase fallback removed), config centralization, removal of the
  `fire-engine;playwright` engine, SSRF hardening in the playwright service, new engines
  (`wikipedia`, `x-twitter`, `exchange`), new formats and feature flags, and the
  jest→vitest test-runner migration.

### Fork layer (preserved through the merge)
- Self-hosted branding, DNA extraction, scroll screenshots, pluggable screenshot storage
  (S3/MinIO + local), configurable `waitUntil`, per-request proxy for playwright, and the
  standalone `playwright` engine with `screenshot`/`branding`/`dna`/`stealthProxy` enabled.
- Fixed a real validation gap surfaced by the new E2E: the `storage` refine now runs on
  the live `/v2/scrape` route (`scrapeRequestSchema`), not only on `scrapeOptions`.

### CI / tooling
- **Fork Guard** — invariant verifier (46 checks) + 14 behavioural contract tests, on
  every PR, no secrets.
- **Fork E2E** — a secret-free runtime gate: real scrape through the self-hosted
  playwright engine, screenshot upload to MinIO, `waitUntil`, per-request proxy, byte
  tracking.
- **Workflow hygiene** — disabled upstream-only workflows (SDK publish/test, GHCR deploys
  for go/nuq/redis, Scrape Evals, etc.) that can only fail or publish artifacts the fork
  does not ship. Active workflows are now just: Build Custom Images, Fork E2E, Fork Guard,
  Secrets.
- Added `RELEASING.md`, this changelog, and a PR template.

### Deployment note
- Prior deployed image was `0.4.0`. Async batch/crawl requires a live **Redis** (it backs
  concurrency limiting, crawl state and status read-back) and a live **Postgres**
  (`NUQ_DATABASE_URL`); **RabbitMQ is optional** (NuQ falls back to Postgres
  `LISTEN/NOTIFY`). Sync `/v2/scrape` runs inline and needs neither.

[0.5.2]: https://github.com/giglabo/firecrawl/releases/tag/v0.5.2
[0.5.1]: https://github.com/giglabo/firecrawl/releases/tag/v0.5.1
[0.5.0]: https://github.com/giglabo/firecrawl/releases/tag/v0.5.0
