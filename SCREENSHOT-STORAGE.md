# Pluggable Screenshot Storage

Screenshots captured by Firecrawl can be stored using pluggable providers instead of the default Supabase upload (cloud-only). This enables self-hosted deployments to persist screenshots to S3-compatible services (MinIO, AWS S3, DigitalOcean Spaces) or the local filesystem.

## Architecture

```
uploadScreenshot transformer
  → resolveProvider(request.storage?)
    → Per-request config (highest priority)
    → Env var config (cached singleton)
    → null (no provider)
  → provider.upload(buffer, key, contentType)
  → returns URL

Fallback chain: Request provider → Env provider → Supabase (cloud) → data URI
```

## Providers

### S3 Storage Provider

Works with AWS S3 and any S3-compatible service (MinIO, DigitalOcean Spaces, Backblaze B2, etc.).

**Env var configuration:**
```bash
SCREENSHOT_STORAGE_PROVIDER=s3
SCREENSHOT_STORAGE_S3_BUCKET=firecrawl-screenshots
SCREENSHOT_STORAGE_S3_ACCESS_KEY_ID=your-access-key
SCREENSHOT_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-key

# Optional
SCREENSHOT_STORAGE_S3_ENDPOINT=http://minio:9000     # Custom endpoint (MinIO, etc.)
SCREENSHOT_STORAGE_S3_REGION=us-east-1                # AWS region
SCREENSHOT_STORAGE_S3_FORCE_PATH_STYLE=true           # Path-style URLs (required for MinIO)
SCREENSHOT_STORAGE_S3_PUBLIC_URL=http://localhost:9000/firecrawl-screenshots  # Custom public URL base
```

**URL construction logic:**
1. If `publicUrl` is set: `{publicUrl}/{key}`
2. Else if custom `endpoint` + `forcePathStyle`: `{endpoint}/{bucket}/{key}`
3. Else if custom `endpoint` (virtual-hosted): `{protocol}//{bucket}.{host}/{key}`
4. Else (default AWS): `https://{bucket}.s3.amazonaws.com/{key}`

### Local Storage Provider

Writes screenshots to a local filesystem directory. Useful for development or single-node deployments.

**Env var configuration:**
```bash
SCREENSHOT_STORAGE_PROVIDER=local
SCREENSHOT_STORAGE_LOCAL_DIR=/data/screenshots

# Optional
SCREENSHOT_STORAGE_LOCAL_PUBLIC_URL=http://localhost:9000  # Base URL for download links
```

Without `publicUrl`, files are referenced as `file:///data/screenshots/{key}`.

## Per-Request Configuration

Override storage on a per-request basis by passing `storage` in the scrape options:

```json
{
  "url": "https://example.com",
  "formats": [{ "type": "screenshot" }],
  "storage": {
    "provider": "s3",
    "prefix": "my-project/screenshots",
    "s3": {
      "bucket": "my-bucket",
      "accessKeyId": "...",
      "secretAccessKey": "...",
      "endpoint": "http://minio:9000",
      "forcePathStyle": true,
      "publicUrl": "http://localhost:9000/my-bucket"
    }
  }
}
```

**Local example:**
```json
{
  "storage": {
    "provider": "local",
    "local": {
      "directory": "/tmp/screenshots",
      "publicUrl": "http://localhost:8080/files"
    }
  }
}
```

Per-request config takes priority over env var config.

## Storage Key Format

Each screenshot is stored with key: `{prefix}{scrapeId}-{uuid}.{ext}`

The `{prefix}` is determined by (in priority order):
1. Per-request `storage.prefix` field in the payload
2. `SCREENSHOT_STORAGE_S3_PREFIX` env var
3. Empty (bucket root) — default

For example, with `"prefix": "screenshots"` the key becomes `screenshots/{scrapeId}-{uuid}.{ext}`. Without a prefix, files go directly to the bucket root.

The `{ext}` is determined by the screenshot `format` option: `png` (default), `jpeg`, or `webp`. When `format` is `"webp"`, the raw PNG is converted to WebP via a native Rust module before upload, and the content type is set to `image/webp`.

## Upload Concurrency

When uploading multiple screenshots (e.g. scroll capture), uploads are batched for performance. The batch size is controlled by `SCREENSHOT_UPLOAD_CONCURRENCY` (default: `6`). Within each batch, uploads run in parallel; batches run sequentially.

For example, 20 screenshots with concurrency 6 = 4 batches of 6, 6, 6, 2.

Set to `1` for fully sequential uploads.

## Env Var Reference

| Variable | Type | Required | Description |
|---|---|---|---|
| `SCREENSHOT_STORAGE_PROVIDER` | `"s3"` \| `"local"` | Yes | Storage provider to use |
| `SCREENSHOT_STORAGE_S3_ENDPOINT` | string | No | Custom S3 endpoint URL |
| `SCREENSHOT_STORAGE_S3_REGION` | string | No | AWS region |
| `SCREENSHOT_STORAGE_S3_BUCKET` | string | For S3 | S3 bucket name |
| `SCREENSHOT_STORAGE_S3_ACCESS_KEY_ID` | string | For S3 | AWS access key ID |
| `SCREENSHOT_STORAGE_S3_SECRET_ACCESS_KEY` | string | For S3 | AWS secret access key |
| `SCREENSHOT_STORAGE_S3_FORCE_PATH_STYLE` | boolean | No | Use path-style URLs (for MinIO) |
| `SCREENSHOT_STORAGE_S3_PUBLIC_URL` | string | No | Custom public URL prefix |
| `SCREENSHOT_STORAGE_S3_PREFIX` | string | No | Key prefix for S3 objects (default: empty = bucket root) |
| `SCREENSHOT_UPLOAD_CONCURRENCY` | number | No | Parallel uploads per batch (default: `6`, set `1` for sequential) |
| `SCREENSHOT_STORAGE_LOCAL_DIR` | string | For local | Filesystem directory path |
| `SCREENSHOT_STORAGE_LOCAL_PUBLIC_URL` | string | No | Public URL base for download links |

## Files

| File | Purpose |
|---|---|
| `apps/api/src/lib/storage/index.ts` | Interface, factory, provider resolution |
| `apps/api/src/lib/storage/s3.ts` | S3StorageProvider implementation |
| `apps/api/src/lib/storage/local.ts` | LocalStorageProvider implementation |
| `apps/api/src/scraper/scrapeURL/transformers/uploadScreenshot.ts` | Integration with scrape pipeline |
