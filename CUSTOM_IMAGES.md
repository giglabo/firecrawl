# Custom Docker Images

This fork publishes custom Docker images for the API and Playwright services to GitHub Container Registry (GHCR).

## Images

| Image | Description |
|-------|-------------|
| `ghcr.io/<owner>/firecrawl` | API + worker (self-hosted branding, DNA script, storage) |
| `ghcr.io/<owner>/playwright-service` | Playwright browser service (cookie banner dismissal) |

Both images are built for `linux/amd64` and `linux/arm64`.

## How images are built

The workflow `.github/workflows/build-custom-images.yml` triggers on:

- **Tag push** (`v*`) — builds, pushes, and tags with both `latest` and the semver version
- **Manual dispatch** — builds and pushes with `latest` tag only

Each service is built per-platform, then a multi-arch manifest is created and pushed.

## Publishing a release

```bash
# Tag and push
git tag v1.0.0
git push origin v1.0.0
```

This produces:

```
ghcr.io/<owner>/firecrawl:latest
ghcr.io/<owner>/firecrawl:1.0.0
ghcr.io/<owner>/firecrawl:linux-amd64
ghcr.io/<owner>/firecrawl:linux-arm64

ghcr.io/<owner>/playwright-service:latest
ghcr.io/<owner>/playwright-service:1.0.0
ghcr.io/<owner>/playwright-service:linux-amd64
ghcr.io/<owner>/playwright-service:linux-arm64
```

## Using custom images in docker-compose

Replace the `build:` directives with `image:` in `docker-compose.yaml`:

```yaml
x-common-service: &common-service
  # build: apps/api
  image: ghcr.io/<owner>/firecrawl:latest

services:
  playwright-service:
    # build: apps/playwright-service-ts
    image: ghcr.io/<owner>/playwright-service:latest
```

Or in the self-hosted overlays (`docker-compose.selfhost.yaml` / `docker-compose.selfhost-local.yaml`), override the image:

```yaml
services:
  api:
    image: ghcr.io/<owner>/firecrawl:latest
  playwright-service:
    image: ghcr.io/<owner>/playwright-service:latest
```

## Pulling images

Images are public by default for public repos. For private repos, authenticate first:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <username> --password-stdin
docker pull ghcr.io/<owner>/firecrawl:latest
```

## Prerequisites

The workflow uses `GITHUB_TOKEN` which is automatically provided by GitHub Actions. No additional secrets are required.

For build caching, GitHub Actions cache (`type=gha`) is used to speed up subsequent builds.
