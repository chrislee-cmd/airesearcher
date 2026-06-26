# SOC 2 — Change Management (CC8) 점검

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-soc2-audit-baseline-2026-06-26.md`
- **TSC**: Security (CC8.1~CC8.3), Availability (A1.2), Processing Integrity (PI1.2)
- **범위**: 코드 변경 (PR → CI → 머지 → deploy), DB 마이그레이션 변경, 환경 변수 변경, infra 변경 (Vercel/Supabase/CI workflow/branch protection), 긴급 변경 (hotfix), rollback 절차

---

## 0. 요약

**판정**: **Critical Gap** — 기술 통제 강함 + 정책 형식 미흡 + segregation of duties 미강제.

PROJECT.md §3 의 브랜치/PR/머지 규칙이 사실상 change management policy 역할을 하나 SOC 2 정식 형식이 아님. branch protection 의 `required_approving_review_count = 0` + `enforce_admins = false` + commit signing 미사용으로 CC8.1 (변경 권한 부여) 가 fail likely.

후속 PR: `SOC-010` (P0-S, branch protection 강화 + reviewer ≥ 1), `SOC-011` (P1-S, deploy approval gate), `SOC-012` (P1-S, rollback runbook), `SOC-013` (P1-S, DB migration review policy), `SOC-019-CM` (P1-S, change management policy 정식 문서).

---

## 1. SOC 2 CC8 요구사항 매핑

| CC8.x | 요구사항 | 우리 상태 |
|---|---|---|
| **CC8.1** | infrastructure / data / software / 절차의 변경을 설계·인가·문서·테스트·승인·구현 | ⚠ 부분 (PR + CI 강제, but reviewer 0, deploy approval 0) |
| **CC8.2** | emergency change 의 인가 + 문서 + 사후 review | ❌ hotfix 절차 PROJECT.md 에 있으나 SOC 2 형식 미준수 |
| **CC8.3** | 일반 변경의 사후 review + change log 보존 | ⚠ git log + PR list 가 fact-based evidence, but change ticket 시스템 없음 |

---

## 2. 현재 change management 체계 (PASS + GAP)

### 2.1 코드 변경 흐름 (`feat/*`, `fix/*`, `chore/*`, `hotfix/*`)

```
worker worktree → commit (husky pre-commit + commit-msg)
  ↓
push origin <branch>
  ↓
gh pr create --base main
  ↓
[CI: Lint+Typecheck, Secrets scan, Vercel preview build] (3 status check)
  ↓
사용자 review (manual, optional) — required_approving_review_count = 0
  ↓
사용자 (chrislee) 가 squash merge
  ↓
Vercel automatic production deploy (main push trigger)
```

### 2.2 강제되는 gates (PASS — PROJECT.md §3.8)

| 가드 | 위치 | 강제도 | 우회 가능? |
|---|---|:-:|:-:|
| `.env*` 차단 | pre-commit | hard | --no-verify 로 우회 가능 (정책상 금지 — PROJECT.md §6) |
| `messages/*.json` parse | pre-commit | hard | --no-verify 로 우회 |
| gitleaks staged | pre-commit | hard | --no-verify 로 우회 (CI 가 catch) |
| migration timestamp 14자리 | pre-commit + CI `Migration naming check` | hard | --no-verify 로 우회 (CI 가 catch) |
| commit prefix | commit-msg | hard | --no-verify 로 우회 |
| lint-staged | pre-commit | **soft** (`\|\| true`) | 자동 fix 시도, 실패 시도 commit 진행 |
| design-system lint | CI `Design-system lint (blocking)` | hard | admin force-merge 만 가능 |
| `pnpm lint` full | CI `Lint` | hard | admin force-merge 만 가능 |
| `pnpm typecheck` | CI | hard | 동일 |
| gitleaks full history | CI `secrets-scan` | hard | 동일 |
| Vercel preview build | CI status check | hard | 동일 |
| branch protection (main 직접 push 금지) | GitHub | hard | enforce_admins=false → admin 우회 가능 |
| status check up-to-date (`strict: true`) | GitHub | hard | 동일 |
| linear history (squash merge) | GitHub | hard | 동일 |
| force-push / branch delete 금지 | GitHub | hard | 동일 |

### 2.3 강제 안 되는 gates (GAP — SOC 2 결손)

| missing 가드 | SOC 2 영향 | 권장 조치 |
|---|---|---|
| `required_approving_review_count = 0` → reviewer 분리 없음 | **CC8.1 fail** | reviewer ≥ 1 강제 (PR-SOC-010) |
| `enforce_admins = false` → admin (chrislee) 가 branch protection 우회 가능 | CC8.1 fail | enforce_admins = true (caveat: 1인 운영 시 emergency fix 자가 stuck — backup operator 필요) |
| `required_signatures = false` → commit signing 미강제 | CC8.1 partial | GPG 서명 강제 (CISO 결정) |
| **deploy approval gate 없음** — main merge = 자동 production | CC8.1 partial | Vercel "Promotions" + manual approve, 또는 staging 분리 |
| **rollback runbook 없음** | CC8.2 fail | `docs/runbook-rollback.md` 작성 (PR-SOC-012) |
| **DB migration review policy 없음** | CC8.1 partial | `docs/policy-migration-review.md` (PR-SOC-013) |
| **change ticket 시스템 없음** (Linear/Jira) | CC8.3 partial | GitHub Issue / Linear 가 사실상 PR 단위 ticket. 정책 명시 필요 |
| **dep-audit non-blocking** (SEC-011) | CC8.1 (security change 인가) partial | Dependabot + dep-audit hard block (PR-SOC-023, SEC-011 와 동일) |

---

## 3. SOC 2 change types 분류

### 3.1 Standard change

- **정의**: 기존 절차 안에서 routine 변경 (e.g., 새 피처, 버그 fix, 의존성 minor 업데이트)
- **현재**: PR + CI + (optional) review + squash merge
- **gap**: reviewer 분리 없음 + change log 별도 시스템 없음 (PR list 가 사실상의 log)

### 3.2 Emergency change (hotfix)

- **정의**: production 깨졌을 때 긴급 fix (PROJECT.md §5.3)
- **현재 절차**: main 에서 분기 → fix → PR → 빠른 review → squash merge
- **SOC 2 요구**: emergency change 의 (a) 인가 (b) 사전·사후 review (c) post-incident review
- **gap**: emergency criteria 정의 없음 (어느 상황이 hotfix vs standard?), post-incident review 의무 없음

### 3.3 Significant change

- **정의**: 새 시스템 도입, schema rewrite, vendor 변경, 권한 모델 변경 등 — high blast radius
- **현재**: 같은 PR 절차 + PROJECT.md §3.2 "1 작업 = 1 브랜치 = 1 PR"
- **gap**: significant change 식별 + 사전 risk 평가 절차 없음. CISO sign-off 의무 없음

### 3.4 Migration (DB schema)

- **현재**: `pnpm migration:new <name>` → timestamp prefix → PR → CI naming check → 머지 → **수동 `supabase db push`** (PROJECT.md §7.5)
- **gap**: production 적용은 manual + 책임자 1명. dry-run / staging 검증 의무 없음

### 3.5 Infrastructure change (Vercel / Supabase / CI)

- **현재**: Vercel env 변경 = `vercel env add` 또는 dashboard. CI 변경 = `.github/workflows/*` PR. branch protection 변경 = GH API.
- **gap**: 무료 change 추적 (특히 dashboard 만 사용 시), Vercel/Supabase audit_log 의존

---

## 4. 발견 상세

### 🔴 SOC-010 — Branch protection 의 reviewer ≥ 1 미강제 (P0-S, CRITICAL)

- **현재**: `gh api repos/chrislee-cmd/airesearcher/branches/main/protection` → `required_approving_review_count = 0`
- **SOC 2 영향**: CC8.1 (변경 인가 + segregation of duties) — fail. 코드 작성자가 자기 PR 을 머지 가능 → 1인이 모든 단계 책임
- **현재 실태**: chrislee 가 자기 PR 을 self-merge — Type 1 audit 시 즉시 finding
- **권장 조치**:
  ```bash
  gh api -X PUT repos/chrislee-cmd/airesearcher/branches/main/protection \
    -f required_pull_request_reviews.required_approving_review_count=1 \
    -f required_pull_request_reviews.dismiss_stale_reviews=true
  ```
- **caveat (1인 운영 단계)**: backup operator (e.g., contractor 또는 자동화된 CODEOWNERS bot) 도입 까지는 owner override 가능한 형태 유지. SOC 2 evaluator 가 "single-person operation 의 임시 통제" 로 인정 가능 — single-person organization 의 compensating control evidence 필요 (예: CISO + CTO 가 모든 PR 의 사후 review log 보존)

### 🔴 SOC-011 — Deploy approval gate 없음 (P1-S, HIGH)

- **현재**: main merge → Vercel webhook → 자동 production deploy. 사람 승인 단계 없음
- **SOC 2 영향**: CC8.1 (배포 인가) — partial. preview 단계에서 검증 가능하나 production 직전 gate 없음
- **권장 조치 (option 1 — Vercel Promotions)**:
  - Vercel project → "Production Branch" 를 별도 `production` 으로 변경 → main 머지는 staging deploy → 사용자가 dashboard 에서 "Promote to production" 클릭
- **권장 조치 (option 2 — staging-first 패턴)**:
  - GitHub Action: main merge → staging deploy → smoke test → manual `workflow_dispatch` 로 production promote
- **trade-off**: 현재 빠른 iteration (commit → production 5분) 이 핵심 강점. CISO 와 trade-off 협의

### 🟡 SOC-012 — Rollback runbook 없음 (P1-S, HIGH)

- **현재**: PROJECT.md §7.6 의 Vercel preview 정리 절차만. production rollback 명시 없음
- **Vercel rollback 옵션**:
  - dashboard → Deployments → 이전 deploy → "Promote to Production"
  - `vercel rollback <url>` CLI
  - `vercel ls` 로 이전 deploy 확인
- **DB rollback**: Supabase migration 은 단방향 — 자동 rollback 없음. 별도 reverse migration 작성 필요 (PROJECT.md 미명시)
- **권장 조치**: `docs/runbook-rollback.md` 신규
  - Vercel rollback CLI 명령
  - DB migration rollback 절차 (reverse migration 또는 manual SQL fix)
  - rollback 시 audit_log 기록 의무
  - rollback 후 post-incident review 트리거
- **SOC 2 영향**: CC8.2 (emergency change) + A1.2 (recovery) — partial

### 🟡 SOC-013 — DB migration 인간 review policy 없음 (P1-S, HIGH)

- **현재**: CI 의 `Migration naming check` 만 자동. PR review 의무 X (전체 reviewer = 0)
- **위험**: 14자리 timestamp prefix 가 맞아도 잘못된 ALTER (예: RLS policy drop, NOT NULL on populated column, FK 없음 등) 가 production DB 에 직접 적용 가능
- **PROJECT.md 의 함정 §7.8 / §7.9 / §7.10 가 이미 부비트랩 사례**:
  - §7.8: `alter publication` 누락 → realtime 침묵
  - §7.9: 4-digit prefix legacy 충돌
  - §7.10: PostgREST embed 의 빈 결과
- **권장 조치**: `docs/policy-migration-review.md`
  - migration PR 은 **별도 reviewer 1명** 의 명시 승인 필수 (CODEOWNERS file 로 `supabase/migrations/**` 에 reviewer 강제)
  - dry-run 절차: staging Supabase project (SOC-009 의 dev project) 에서 먼저 적용 → sanity SQL → production 적용
  - reverse migration 동봉 (가능한 경우)
  - production `supabase db push` 는 책임자 1명 + screenshot evidence 보관

### 🟡 SOC-019-CM — Change management policy 정식 문서 부재 (P1-S, HIGH)

- **현재**: PROJECT.md §3 이 사실상 policy 지만 SOC 2 형식 (목적 / 범위 / 책임자 / 절차 / 예외 / review cycle) 미준수
- **권장 조치**: `docs/policy-change-management.md` 신규 — SOC 2 evaluator 가 한 문서에서 모든 답을 얻을 수 있는 형식
  ```markdown
  # Change Management Policy

  ## 1. Purpose
  ai-researcher 의 모든 변경 (code / DB / infra / env) 을 안전하게 처리 ...

  ## 2. Scope
  - GitHub repo `chrislee-cmd/airesearcher` 의 `main` 브랜치
  - Vercel project `ai-researcher`
  - Supabase project (prod + dev)
  - CI workflows / branch protection

  ## 3. Roles
  - Owner / approver: chrislee (CISO + CEO 겸직 현 단계)
  - Reviewer: PROJECT.md 의 owner 또는 backup operator
  - Implementer: worker (인간 또는 jarvis-launched agent)

  ## 4. Change types & approval
  | type | criteria | approver | minimum review |
  |---|---|---|---|
  | Standard | routine feature/fix/chore | owner | 1 reviewer |
  | Emergency | production outage | owner | post-merge review |
  | Significant | new vendor / schema rewrite / auth model 변경 | CISO sign-off | 1 reviewer + risk doc |

  ## 5. Procedures
  - PR-based — PROJECT.md §3 절차 참조
  - DB migration — docs/policy-migration-review.md
  - Emergency hotfix — PROJECT.md §5.3 + post-incident review

  ## 6. Exceptions
  - --no-verify 사용 금지 (PROJECT.md §6)
  - branch protection 우회는 CISO 사전 승인 + post-action review

  ## 7. Review cycle
  - 매 분기 (3/6/9/12 월) 이 policy + branch protection settings + CI workflow review
  - 결과 → access-review/YYYY-QN.md
  ```

### 🟡 SOC-020-CM — `enforce_admins = false` (P2-S, MEDIUM)

- **현재**: admin (chrislee-cmd) 가 자기 PR 의 status check 실패에도 force-merge 가능
- **SOC 2 영향**: CC8.1 partial
- **trade-off**: 1인 운영 시 emergency fix 막힘 (status check broken + production down). solution = backup admin (예: contractor) 또는 `enforce_admins = true` 강제 후 evidence-based emergency procedure 작성
- **권장 조치**: backup operator 도입 후 `enforce_admins = true` flip

### 🟡 SOC-021-CM — Commit signing 미사용 (P2-S, LOW-MEDIUM)

- **현재**: `required_signatures = false`. GitHub web 머지 commit + worker commit 모두 unsigned
- **SOC 2 영향**: CC8.1 (변경 인가) low — commit author 의 신원 확인 약함. 다만 GitHub 의 push 권한 자체가 통제 layer 라 single-vector 위험 낮음
- **권장 조치**: P3 (선택). 도입 시 GPG / sigstore (Gitsign) — 그러나 husky / Vercel CI workflow 와 호환성 사전 검증 필요

### 🟢 SOC-022-CM — dep-audit non-blocking → hard block (P1-S, HIGH — SEC-011 와 동일)

- **현재**: `.github/workflows/ci.yml:109` `continue-on-error: true` (PR-SEC11 미해소)
- **권장 조치 (SEC1 의 PR-SEC11 와 동일, 우선순위 격상)**:
  - Dependabot 활성 (GitHub repo settings → "Enable Dependabot security updates")
  - `--audit-level=high` 유지하되 `continue-on-error` 제거
  - branch protection 의 required status checks 에 `Dependency audit` 추가
  - 점진 적용: 우선 alerts-only mode → 1주 watch → hard block flip

---

## 5. emergency change (hotfix) — SOC 2 형식 보강

### 5.1 현재 (PROJECT.md §5.3)

```bash
# 워커 worktree
git checkout main && git pull
git checkout -b hotfix/<desc>
# 수정 → 커밋 → push
gh pr create --base main --title "hotfix: ..."
# 빠른 리뷰 후 squash merge
```

### 5.2 SOC 2 요구 보강

| 단계 | 현재 | SOC 2 보강 |
|---|---|---|
| 1. 인지 | manual | 자동 알림 (Sentry/audit_log/Vercel health → Slack — SOC-003 와 연결) |
| 2. 분류 | 즉석 | severity matrix (Critical/High/Medium) — IR runbook 의 §2 참조 |
| 3. 인가 | chrislee 단독 | CISO override + audit_log `change.emergency` 이벤트 |
| 4. 수정 | PR | PR + "Emergency" label (CODEOWNERS / 자동 reviewer skip) |
| 5. 검증 | preview build | preview build + manual smoke test checklist |
| 6. 머지 | squash | squash + commit message 에 `hotfix:` prefix + incident ID 참조 |
| 7. 사후 review | (없음) | 24h 안에 post-mortem 작성 + audit_log 에 review evidence |

### 5.3 권장 추가 문서

`docs/runbook-emergency-change.md` 신규:
- emergency 정의 + criteria
- 의사결정 tree (incident severity → 응답 시간 → 책임자)
- 사후 review 템플릿
- "fast-path" PR 절차 (reviewer skip + post-merge review 보장)

---

## 6. Change log / audit trail (CC8.3)

### 6.1 현재 evidence (PASS)

- ✅ `git log` (squash merge 로 1 PR = 1 commit)
- ✅ GitHub PR list + PR body (테스트 plan + reviewer comment)
- ✅ `gh pr view <N>` 로 머지 시간 / 머지자 / status check / commit list 모두 retrieve
- ✅ Vercel deployment history (dashboard + `vercel ls`)
- ✅ Supabase migrations 디렉토리 (모든 schema 변경의 source-of-truth)
- ✅ audit_log 테이블 (PR #421 / `20260626020922_audit_log.sql`)

### 6.2 GAP

- ⚠ **PROJECT.md / AGENTS.md / branch protection / Vercel env / Supabase RLS policy 등의 변경**: PR 안에 들어가지만 별도 audit log 분리 없음
- ⚠ **audit_log 사용 범위**: 어느 행위가 logged 되는지 명시 정책 없음. PR #421 의 helper (`src/lib/audit.ts`) 가 어디서 호출되는지 SoT 없음
- ❌ **manual change** (dashboard 만): Vercel env 변경, Supabase RLS dashboard 변경, GH settings 변경 → vendor 측 audit log 의존 (Vercel events / Supabase audit / GH org events)

### 6.3 권장 조치

`docs/policy-audit-trail.md` 신규:
- 어느 행위가 audit_log 에 logged 되어야 하는지 매트릭스
- audit_log 보존 정책 (e.g., hot 90일 / cold 1년 / 영구 archive)
- vendor 측 audit log 정기 export 절차 (분기 1회)

---

## 7. Type 1 evaluator 질문 prep

| 질문 | 우리 답 (현재) | 보강 후 답 |
|---|---|---|
| "코드 변경 절차?" | PR + branch protection (구두) | `docs/policy-change-management.md` v1 |
| "code reviewer 누구?" | self (reviewer 0) | CODEOWNERS + reviewer ≥ 1 강제 evidence |
| "긴급 변경 절차?" | hotfix (구두) | `docs/runbook-emergency-change.md` + 실 사례 |
| "production rollback?" | (구두) | `docs/runbook-rollback.md` + 실 drill 결과 |
| "DB migration 책임자?" | (구두) | `docs/policy-migration-review.md` + CODEOWNERS supabase/migrations/** |
| "변경 후 review 어떻게?" | PR comment + (없음) | post-merge review log + audit_log evidence |
| "dep CVE 패치 ?" | non-blocking | Dependabot active + hard block evidence |
| "change log 어디?" | git log | git log + GitHub PR API + audit_log table dump |

---

## 8. 후속 조치 요약

| ID | 우선순위 | 작업 | size | 의존 |
|---|:-:|---|---|---|
| `SOC-010` | **P0-S** | branch protection → reviewer ≥ 1 강제 | S | CISO 결정 |
| `SOC-019-CM` | P1-S | `docs/policy-change-management.md` 작성 | M | — |
| `SOC-011` | P1-S | deploy approval gate (Vercel Promotions or staging-first) | M | CISO 결정 + Vercel project 재배치 |
| `SOC-012` | P1-S | `docs/runbook-rollback.md` + 1회 drill 실시 | M | — |
| `SOC-013` | P1-S | `docs/policy-migration-review.md` + CODEOWNERS file 추가 | M | SOC-010 |
| `SOC-022-CM` | P1-S | Dependabot active + dep-audit hard block (SEC-011 동일) | S | — |
| `SOC-020-CM` | P2-S | backup operator 도입 후 `enforce_admins = true` | L (org) | backup operator 확보 |
| `SOC-021-CM` | P3-S | commit signing (sigstore/GPG) | M | husky/Vercel 호환성 검증 |

---

## 9. 결론

기술 통제는 SOC 2 의 CC8 가 요구하는 **automatic gate (preventive)** 의 80% 를 covered. 결손은 (1) **인가 분리** (reviewer ≥ 1) (2) **deploy approval** (3) **rollback runbook** (4) **migration review policy** (5) **정식 policy 문서**. 5~6주 PR 시퀀스로 Type 1 통과 가능. Type 2 는 6mo+ 운영 evidence (post-merge review log / migration review sign-off / Dependabot patch PR / rollback drill) 누적 필요.
