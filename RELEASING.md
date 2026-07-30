# Releasing (giglabo/firecrawl fork)

This is the release process for **our fork**. It is intentionally decoupled from
upstream `firecrawl/firecrawl`: upstream tags `v2.x`, we ship an independent `0.x`
line of container images to our own GHCR namespace.

## Versioning

The fork uses semver on an independent `0.x` track:

- **PATCH** (`0.5.0 → 0.5.1`) — a fix on top of the current upstream baseline; no
  new upstream merge, or a trivial one.
- **MINOR** (`0.5.0 → 0.6.0`) — a substantial upstream merge, or a notable fork
  feature. This is the common case (each big `git merge origin/main` is a minor).
- **`1.0.0`** — reserved for a deliberate "declared stable" milestone, not for
  routine merges.

There is **no `VERSION` file**. The image version is derived **entirely from the git
tag** — `Build Custom Images` reads `VERSION=${GITHUB_REF#refs/tags/v}`. The tag *is*
the version. `apps/api/package.json` stays at upstream's `1.0.0` and is not our
version source.

## What a tag publishes

Pushing a tag `vX.Y.Z` to `main` triggers `.github/workflows/build-custom-images.yml`,
which builds and pushes multi-arch manifests to GHCR:

- `ghcr.io/giglabo/firecrawl:X.Y.Z` and `ghcr.io/giglabo/firecrawl:latest`
- `ghcr.io/giglabo/playwright-service:X.Y.Z` and `:latest`

A plain push to `main` (no tag) builds nothing publishable; a `pull_request` runs the
build in validate-only mode (`load`, not `push`).

## Pre-release checklist

Run before tagging (see also `CLAUDE.md` and the `merge-upstream` skill):

```bash
node scripts/verify-fork-invariants.mjs          # must be 46/46
# tsc needs the native lib built first (regenerates the napi .d.ts):
(cd apps/api/native && pnpm install)
(cd apps/api && pnpm install --ignore-scripts && ./node_modules/.bin/tsc --noEmit)
(cd apps/playwright-service-ts && pnpm install --ignore-scripts && ./node_modules/.bin/tsc --noEmit)
```

On the PR, all fork gates must be green: **Fork invariants**, **Fork contract tests**,
**Fork snips (self-hosted playwright)** and **gitleaks**. (Upstream's own workflows —
SDK publish/test, Server Test Suite — are disabled on this fork and are not gates.)

## Steps

1. **Land the code.** Open a PR against `main` and merge it once the fork gates are
   green. For an **upstream merge**, use a **merge commit** (never squash): squashing
   flattens the `git merge origin/main` commit and the merge-base with upstream
   regresses, so the next merge re-conflicts the entire delta.
2. **Tag the merge commit:**
   ```bash
   gh api repos/giglabo/firecrawl/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<main-sha>
   ```
   or `git tag vX.Y.Z <sha> && git push <fork> vX.Y.Z`.
3. **Watch the build:** `gh run watch <id> --repo giglabo/firecrawl` until the image
   manifests are pushed.
4. **Cut a GitHub Release** on the tag with notes (see `CHANGELOG.md`).
5. **Roll the deployment.** Update the compose on the target host to the new image tag
   (`ghcr.io/giglabo/firecrawl:X.Y.Z`) and redeploy. The compose lives on the host, not
   in this repo.

## Upstream sync cadence

Merge upstream regularly (small, frequent merges beat one 900-commit catch-up). Always
**merge, never rebase**: `git merge origin/main`. Use the **`merge-upstream` skill**
(`.claude/skills/merge-upstream/`), which derives the live conflict surface and carries
the per-file playbook. After each merge, re-run the invariant verifier and add any new
traps to the playbook.
