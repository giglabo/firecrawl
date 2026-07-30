# Changelog

All notable changes to **this fork** (`giglabo/firecrawl`) are documented here. The
fork ships an independent `0.x` image line to `ghcr.io/giglabo/*`; see `RELEASING.md`.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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

[0.5.0]: https://github.com/giglabo/firecrawl/releases/tag/v0.5.0
