# Git history secret scan — 2026-06-26

**Scope**: Full git history of `chrislee-cmd/airesearcher` (all refs, 716 commits, ~6.98 MB blob content).
**Tool**: `gitleaks` v8.30.1 (default ruleset).
**Trigger**: PR-SEC20 (P1, external security review 2026-06-26) — reviewer flagged that the prior audit used a shallow clone and never inspected git history for leaked credentials.

## Result

**0 leaks on `main`'s history (395 commits).**

The all-refs scan surfaced **1 finding**, confirmed false positive:

| Field | Value |
|---|---|
| Rule | `generic-api-key` |
| File | `src/components/autocontents/topics-client.tsx:84` |
| Commit | `54e79d2` (2026-06-25, branch `feat/autocontents-native-2-ui-port`, not merged) |
| Match | `ASSIGNMENTS_STORAGE_KEY = "enko.assignments.v1"` |
| Reason flagged | High entropy on the quoted literal |
| Why false positive | `enko.assignments.v1` is a `localStorage` key namespace, not a credential |

Allowlisted in `.gitleaks.toml` via a surgical regex on the literal token (`enko\.[a-zA-Z]+\.v\d+`). Re-scan after allowlist: **0 leaks**.

## Key rotation

Not required. Verified the finding is not an actual credential by reading the surrounding source (a block of `*_STORAGE_KEY` constants for client-side persistence).

## CI integration

`.github/workflows/ci.yml` already has a `secrets-scan` job (added prior to this PR) that:
- Checks out with `fetch-depth: 0` (full history)
- Installs gitleaks v8.30.1
- Runs `gitleaks detect --redact --verbose --no-banner`

This job picks up the new `.gitleaks.toml` automatically. **No new workflow file added** — the spec's `.github/workflows/secret-scan.yml` would have duplicated the existing job and caused two parallel scans per PR.

## Local pre-commit

`.husky/pre-commit` already runs gitleaks against staged files when the binary is installed locally (PROJECT.md §3.8). The new `.gitleaks.toml` is honored there too.

## What this audit does *not* cover

- **Credentials leaked via channels other than git** — Vercel build logs, screenshots in Slack, copy-pasted into issues. Out of scope for gitleaks.
- **Forks / mirrors** — if a secret was ever pushed publicly, force-push or BFG cannot recall GitHub's cache or third-party forks. Rotation is the only effective remediation. Not relevant here (0 real findings) but stated for completeness.
- **Runtime secrets** — `.env*` files are blocked at pre-commit and via `.gitignore`; covered separately.

## Reproduce

```bash
brew install gitleaks            # v8.30.1
gitleaks detect --source . --no-banner --report-path /tmp/gitleaks.json
# expect: "no leaks found"
```

To scan only `main`'s reachable history (excludes WIP feature branches):

```bash
gitleaks detect --source . --log-opts="HEAD" --no-banner
```
