# Self-Hosted Deployment

This guide covers running Firecrawl in a fully self-hosted mode without cloud dependencies (no Supabase, no RabbitMQ, no LLM for branding).

## Quick Start

```bash
# Local filesystem storage (default)
./selfhost.sh

# MinIO (S3-compatible) storage
./selfhost.sh minio

# Tear down everything (containers, volumes, images)
./selfhost.sh nuke
```

## Services

| Service | Port | Description |
|---|---|---|
| API | 13002 | Firecrawl API server |
| Playwright | 13000 | Browser automation service |
| PostgreSQL | 15432 | Database |
| Redis | 16379 | Cache |
| MinIO API | 19000 | S3-compatible storage (minio variant only) |
| MinIO Console | 19001 | MinIO web UI (minio variant only) |
| Nginx | 19000 | Static file server (local variant only) |

## Storage Variants

### Local Filesystem (default)

Screenshots stored in `./data/screenshots` on the host, served by Nginx on port 19000.

```bash
SCREENSHOT_STORAGE_PROVIDER=local
SCREENSHOT_STORAGE_LOCAL_DIR=/data/screenshots
SCREENSHOT_STORAGE_LOCAL_PUBLIC_URL=http://localhost:19000
```

### MinIO (S3-compatible)

Screenshots stored in MinIO bucket `firecrawl-screenshots`, auto-created on startup with public download access.

```bash
SCREENSHOT_STORAGE_PROVIDER=s3
SCREENSHOT_STORAGE_S3_ENDPOINT=http://minio:9000
SCREENSHOT_STORAGE_S3_BUCKET=firecrawl-screenshots
SCREENSHOT_STORAGE_S3_ACCESS_KEY_ID=minioadmin
SCREENSHOT_STORAGE_S3_SECRET_ACCESS_KEY=minioadmin
SCREENSHOT_STORAGE_S3_FORCE_PATH_STYLE=true
SCREENSHOT_STORAGE_S3_PUBLIC_URL=http://localhost:19000/firecrawl-screenshots
```

## Key Configuration Differences from Cloud

| Setting | Cloud | Self-Hosted |
|---|---|---|
| `USE_DB_AUTHENTICATION` | `true` | `false` |
| `NUQ_RABBITMQ_URL` | RabbitMQ URL | `""` (empty, disabled) |
| `BRANDING_SKIP_LLM` | `false` | `true` |
| `DEBUG_BRANDING` | `false` | `true` |
| `TEST_SUITE_SELF_HOSTED` | — | `true` |

## Feature Behavior in Self-Hosted Mode

### Branding without LLM

When `BRANDING_SKIP_LLM=true`:
- Logo selection uses heuristic scoring only (confidence >= 0.3 threshold)
- Button classification is skipped
- Output includes `__llm_metadata` field documenting what was skipped and why
- Debug snapshots (`__button_snapshots`, etc.) are preserved in output

### Extract Worker Graceful Degradation

When `NUQ_RABBITMQ_URL` is empty or unset:
- The extract worker logs a "disabled" message and sleeps indefinitely
- The process stays alive (does not crash), preventing harness failures
- No extract jobs are consumed — the extract endpoint is effectively disabled

### Cookie Banner Dismissal

The Playwright service includes automatic cookie banner dismissal (enabled by default, controlled by `DISMISS_COOKIE_BANNERS` env var). It uses a 3-phase approach:

1. **Known selectors** — Clicks buttons from popular consent vendors (OneTrust, Cookiebot, TrustArc, Quantcast, Didomi, Klaro, Osano, Google consent, etc.)
2. **Button text matching** — Falls back to scanning all buttons for consent phrases in 7 languages (English, German, French, Spanish, Italian, Dutch, Portuguese)
3. **CSS hiding** — Last resort: hides known cookie banner elements via CSS and removes `overflow:hidden` from html/body to restore scrolling

### Playwright JavaScript Execution

The Playwright service supports `execute_javascript` in scrape requests, enabling branding and DNA script injection without fire-engine. When JavaScript execution is requested, media blocking is automatically disabled so scripts can analyze images and other media.

## Environment File

The `.env.selfhost` file sets non-default ports to avoid conflicts with local development:

```
PORT=13002
```

All other configuration is set in the docker-compose files.

## Docker Compose Files

| File | Description |
|---|---|
| `docker-compose.selfhost-local.yaml` | Local filesystem storage + Nginx |
| `docker-compose.selfhost.yaml` | MinIO S3-compatible storage |
| `selfhost.sh` | Convenience wrapper script |
| `.env.selfhost` | Port configuration |
