<!--
  giglabo/firecrawl is a FORK of firecrawl/firecrawl.
  PRs target THIS fork's `main` — never upstream. See CLAUDE.md.
-->

## What & why

<!-- One or two sentences. Link any issue. -->

## Type

- [ ] Fork feature / fix (our custom layer)
- [ ] Upstream merge (`git merge origin/main`)
- [ ] CI / tooling / docs

## Fork-layer checklist

- [ ] `node scripts/verify-fork-invariants.mjs` is **46/46**
- [ ] `tsc --noEmit` clean in `apps/api` and `apps/playwright-service-ts`
      (build `apps/api/native` first so the napi `.d.ts` is current)
- [ ] If this touches a **conflict-prone** file (see CLAUDE.md — `types.ts`,
      `engines/index.ts`, `transformers/index.ts`, `playwright-service-ts/api.ts`,
      `uploadScreenshot.ts`, `config.ts`), I preserved every fork feature and the
      transformer-stack order.
- [ ] New engine option blocks carry an explicit `dna` flag.

## Tests

- [ ] Added/updated a snip (happy + failure path) where behaviour changed, or explained why not.
- [ ] Relevant fork snips pass locally
      (`pnpm harness pnpm test:snips:fork`) or I'm relying on **Fork E2E** in CI.

## For an upstream merge

- [ ] Used a **merge commit** (not squash) so the merge-base advances.
- [ ] Recorded any new trap in `.claude/skills/merge-upstream/reference/file-playbook.md`.
