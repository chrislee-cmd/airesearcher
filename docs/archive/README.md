# Stash / Recovery Archive

Patch files and recovery artifacts from incidents where work needed to be preserved outside the normal commit graph.

## 2026-05-04-interview-analyzer-stash.patch

A `git stash` snapshot from a worker agent's interview-analyzer iteration that pre-dated the work merged in PR #2 (`feat/voc-only-cells`). The stash content overlaps the same files PR #2 already refined, so applying it directly would revert improvements. Preserved here as an archive for manual review — extract any still-useful ideas with care.

Contains diffs against (pre-PR-#2) main for:
- `src/app/api/interviews/analyze/route.ts`
- `src/app/api/interviews/extract/route.ts`
- `src/components/interview-analyzer.tsx`
- `src/components/interview-job-provider.tsx`
- `src/components/thinking-panel.tsx`
- `src/lib/interview-schema.ts`

To inspect:
```bash
less docs/archive/2026-05-04-interview-analyzer-stash.patch
# or apply against the pre-PR-#2 main commit if you really want it as code
git apply docs/archive/2026-05-04-interview-analyzer-stash.patch
```
