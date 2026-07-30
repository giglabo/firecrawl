---
name: merge-upstream
description: Merge upstream firecrawl/firecrawl into this fork without silently losing our custom features (DNA extraction, scroll screenshots, pluggable screenshot storage, the standalone-playwright scrape path, configurable waitUntil, per-request proxy, byte tracking). Use when asked to merge, sync, or catch up with upstream, pull in upstream changes, or resolve conflicts against firecrawl main.
---

# Merging upstream into this fork

## Why this needs a skill

This fork re-implements a large slice of functionality that upstream either never
had or actively deleted. Every feature rides on **existing upstream endpoints**
(`POST /v1/scrape`, `POST /v2/scrape`) as additive request/response fields, so
there is no separate surface protecting it — our code is threaded directly through
files upstream rewrites constantly.

The textual conflicts are the easy part; git flags those. The failure mode that
actually bites is a **clean auto-merge that drops our semantics**:

- upstream adds an engine → its option block has no `dna` key → build breaks, or
  worse, someone "fixes" it by deleting the flag
- upstream redefines `branding` as an option-less `z.strictObject` → our
  `customScript` / `constants` / `skipProcessor` options start getting rejected
- upstream reorders `transformerStack` → our `uploadScreenshot` and
  `deriveDnaFromActions` quietly fall out
- upstream deletes a file we modified → git reports `UD`, and **the dangling
  imports inside our kept version are never flagged**

So: never eyeball a merge here. Prove it with `scripts/verify-fork-invariants.mjs`.

## Ground rules

1. **Merge, never rebase.** `git merge origin/main`. Our history is 20+ commits of
   feature work; rebasing re-resolves every conflict once per commit.
2. **Never open a PR against `origin`.** `origin` is upstream
   (`firecrawl/firecrawl`); `fork` is ours (`giglabo/firecrawl`). Use
   `gh pr create --repo giglabo/firecrawl`.
3. **Fetch over HTTPS.** Both remotes are configured with SSH URLs and SSH host-key
   verification fails in this environment. Do not "fix" the remotes — pass the URL:
   ```bash
   git fetch https://github.com/firecrawl/firecrawl.git 'refs/heads/main:refs/remotes/origin/main'
   git fetch https://github.com/giglabo/firecrawl.git  'refs/heads/main:refs/remotes/fork/main'
   ```
4. **Keep our feature set whole.** If upstream deleted something we depend on, we
   re-home it — we do not drop the feature. The one exception is code that is
   *impossible* to keep (see the Supabase case in `reference/file-playbook.md`);
   call that out explicitly to the user rather than deciding silently.

## Phase 0 — Preflight

```bash
# Fresh upstream (see rule 3), then size the job
git rev-list --left-right --count main...origin/main   # ours<TAB>theirs
MB=$(git merge-base main origin/main)

# Work on a branch, never on main
git switch -c chore/merge-upstream-$(git rev-parse --short origin/main)

# Baseline: invariants MUST pass before you start, or you cannot attribute
# post-merge failures to the merge
node scripts/verify-fork-invariants.mjs
```

If the baseline fails, fix that first and separately.

## Phase 1 — Recon before touching anything

Derive the conflict surface instead of trusting any checked-in list.

```bash
# Which of our files did upstream also touch, and does it still exist upstream?
for f in $(git diff --name-only $MB main); do
  n=$(git rev-list --count $MB..origin/main -- "$f")
  [ "$n" -gt 0 ] || continue
  git cat-file -e origin/main:"$f" 2>/dev/null && s=live || s=DELETED-UPSTREAM
  printf '%-5s %-18s %s\n' "$n" "$s" "$f"
done | sort -rn
```

Then do a **throwaway trial merge in a worktree** to get the real conflict list
without dirtying the branch:

```bash
WT=$(mktemp -d)/trial
git worktree add --detach "$WT" HEAD
git -C "$WT" -c user.email=t@l -c user.name=t merge --no-commit --no-ff origin/main
git -C "$WT" status --short | grep -E '^(UU|UD|DU|AA)'
# ... inspect, then:
git worktree remove --force "$WT"
```

Read upstream's log for the areas you own before resolving anything:

```bash
git log --oneline $MB..origin/main -- \
  apps/api/src/scraper/scrapeURL/ apps/playwright-service-ts/ apps/api/src/config.ts
```

Classify every conflicted path into one of four buckets, then apply the matching
rule from Phase 2.

## Phase 2 — Resolution rules

Per-file detail, including every known trap, lives in
**`reference/file-playbook.md`**. Read it before resolving. The rules by bucket:

### Bucket A — ours-only files (should never conflict)

`apps/api/src/scraper/scrapeURL/engines/playwright/index.ts`,
`apps/api/src/lib/storage/**`, `engines/fire-engine/dna-script/**`,
`engines/fire-engine/dnaScript.ts`,
`apps/playwright-service-ts/helpers/dismiss_cookie_banners.ts`, our `snips` tests.

Upstream has never touched these. **A conflict here is a signal, not a chore** —
upstream has started working in our territory. Stop and read their commits before
resolving.

### Bucket B — additive-adjacency conflicts → keep both sides

Both sides appended to the same list, union, or type. This is most of
`controllers/v2/types.ts`. Keep our member *and* theirs.

The trap: "keep both" is wrong when upstream added a **competing definition of the
same key** rather than a new one. Upstream ships
`z.strictObject({ type: z.literal("branding") })` with no options; ours is
`brandingFormatWithOptions` with `customScript` / `skipProcessor` / `constants`.
Two members with the same discriminator means the first match wins and our
options get rejected. **Replace theirs with ours; don't add both.**

### Bucket C — upstream deleted a file we modified (`UD`)

```bash
git checkout --ours <path> && git add <path>
```

Then, because git will not do it for you:

1. Re-add the import/registration upstream removed (e.g. `uploadScreenshot` back
   into `transformerStack`).
2. **Check every import in the kept file still resolves.** Upstream deletes
   modules wholesale; a kept file can reference something that no longer exists:
   ```bash
   grep -n '^import' <path>   # then confirm each target exists on origin/main
   ```

### Bucket D — mechanical / generated

- **`apps/api/pnpm-lock.yaml`** — never hand-merge. Take upstream's, reconcile
  `package.json` by hand (keep both dep sets), then regenerate:
  ```bash
  git checkout --theirs apps/api/pnpm-lock.yaml
  # resolve apps/api/package.json keeping our deps AND theirs, then:
  cd apps/api && pnpm install --lockfile-only
  ```
- **`CLAUDE.md`, `.gitignore`, `.gitleaks.toml`, `knip.config.ts`,
  `native/Cargo.toml`, `Dockerfile`** — keep both sides' entries.

## Phase 3 — Verify (do not skip, do not reorder)

```bash
# 1. Invariants: proves no feature was silently dropped
node scripts/verify-fork-invariants.mjs

# 2. No conflict debris anywhere
git grep -n '^<<<<<<<\|^>>>>>>>' -- . && echo "CONFLICT MARKERS LEFT" || echo clean

# 3. Both TypeScript projects compile
(cd apps/api && npx tsc --noEmit)
(cd apps/playwright-service-ts && npx tsc --noEmit)

# 4. Our e2e tests (never `pnpm start` manually — the harness owns the servers)
cd apps/api && pnpm harness jest -- --testPathPattern="scrape-dna|scrape-storage|scrape-waituntil|scrape-proxy|scrape-bytes-downloaded"
```

`tsc` is the enforcer for the `dna` flag: `engineOptions` is a mapped type over
`featureFlags`, so any engine block upstream adds without `dna` is a compile
error. Add `dna: true` only for engines that can execute JS (chrome-cdp,
playwright); `dna: false` everywhere else.

If the invariant verifier fails, **fix the code, not the check** — unless upstream
legitimately renamed something, in which case update the check and say so.

## Phase 4 — Land

```bash
git commit                       # merge commit; summarize what upstream brought
git push fork HEAD
gh pr create --repo giglabo/firecrawl --base main
```

Let CI run the full suite; only our targeted tests are worth running locally.

## After a successful merge

Add any newly-learned trap to `reference/file-playbook.md` and, if a feature grew
a new load-bearing symbol, add an invariant to
`scripts/verify-fork-invariants.mjs`. The checked-in narrative
`MERGE-GUIDE.md` is a **historical artifact of a merge that was never executed** —
do not treat it as current and do not extend it; this skill supersedes it.
