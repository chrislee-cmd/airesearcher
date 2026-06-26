# SOC 2 — 위험 매트릭스 + 후속 PR (PR-SEC17 ~ PR-SEC25)

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-soc2-audit-baseline-2026-06-26.md`
- **총 발견**: 26건 (Critical 5 · High 12 · Medium 7 · Low 2)
- **사용**: CISO 검토 + spec writer 의 후속 PR 분해 input

---

## 0. 등급 정의

| 등급 | 정의 |
|---|---|
| **Critical (P0-S)** | Type 1 audit 통과 prerequisite. CISO sign-off 즉시 fix 권장. 미해소 시 audit firm 의 첫 finding 가능 |
| **High (P1-S)** | Type 1 + Type 2 evidence 누적 prerequisite. Sprint S1~S3 안 fix |
| **Medium (P2-S)** | Type 2 evidence 운영 시 보강. post-Type-1 1~3개월 |
| **Low (P3-S)** | 인지 / 계획. 대응 옵션이지만 필수 X |

> **"-S" 접미사** = SOC 2 series (SEC1 의 P0/P1/P2/P3 와 구분).

---

## 1. 매트릭스 (전체 26 발견)

| ID | 영역 | TSC | 발견 | 등급 | likelihood | 권장 조치 | 우선 | 의존 |
|---|---|---|---|:-:|:-:|---|:-:|---|
| **SOC-001** | Incident Response | CC7.4 | 인시던트 응답 runbook / 통보 SLA / post-mortem 템플릿 / on-call 전무. SEC1 의 SEC-026 의 SOC 2 표면 | Critical | high | `docs/security-soc2-incident-response.md` v1.0 finalize + CISO sign-off + 1회 tabletop drill | **P0-S** | — |
| **SOC-002** | Access Control | CC6.1 / CC6.3 | 외부 시스템 (GH/Vercel/Supabase/OpenAI/Anthropic 등 9~12종) 의 admin/member 권한 매트릭스 + MFA 강제 evidence 미문서 | Critical | high | `docs/security-access-matrix.md` 작성 + 각 시스템의 "require MFA" 활성 + screenshot evidence | **P0-S** | — |
| **SOC-003** | Monitoring | CC7.2 | Sentry / error tracking 0 → production 사고 invisible. SEC1 의 SEC-012 의 SOC 2 격상 (Type 2 의 detection evidence 핵심) | Critical | high | Sentry 도입 + Slack alert + audit_log 알림 wiring. PII scrub | **P0-S** | — (SEC-012 동일) |
| **SOC-004** | Vendor Mgmt | CC9.2 | 14+ 처리자 의 DPA 서명본 register 없음. 연 1회 review 절차 없음. vendor SOC 2 attestation 확인 ad-hoc | Critical | medium | `docs/vendor-management.md` + `docs/vendors/<vendor>.md` 각 vendor 의 DPA URL + 등급 + 다음 review 일자 | **P0-S** | — |
| **SOC-010** | Change Mgmt | CC8.1 | Branch protection `required_approving_review_count = 0` → segregation of duties 미강제. self-merge 가능 | Critical | high | `gh api -X PUT ...protection` 으로 reviewer ≥ 1 강제 + CODEOWNERS file 추가 | **P0-S** | backup operator (SOC-016) caveat 필요 |
| **SOC-005** | Privacy | P5 | 사용자 권리 행사 evidence 운영 부재 — SEC1 PR-SEC5/6/8 머지 완료, but 6mo+ 운영 evidence 없음 | High | medium | 분기별 권리 행사 (export/delete/consent) 통계 + sample evidence 보관 | P1-S | SEC1 PR-SEC5/6 머지됨 ✓ |
| **SOC-006** | BCP/DR | A1.2 | Supabase backup restore drill 0회. RTO/RPO 미정의 | High | high | (1) Supabase backup plan 확인 (현재 보유 기간) → 정책 문서. (2) 분기별 restore drill 1회 (staging project 으로 복원 + sanity SQL + 시간 기록) | P1-S | — |
| **SOC-007** | Incident Response | CC7.4 | 사고 발생 시 post-mortem 작성·보관 evidence 없음 | High | high | 발생한 incident (intentional drill 포함) 별 `docs/incidents/YYYY-MM-DD-<id>.md` 작성 시작 | P1-S | SOC-001 |
| **SOC-008** | Monitoring | CC2.1 / CC7.2 | audit_log 의 어느 행위가 logged 되어야 하는지 정책 없음. helper 호출 위치 SoT 없음 | High | medium | `docs/policy-audit-trail.md` + `src/lib/audit.ts` 의 호출 매트릭스 문서 | P1-S | SEC1 PR #421 머지됨 ✓ |
| **SOC-009** | Access Control | CC6.2 / CC6.3 | dev 머신에 production `SUPABASE_SERVICE_ROLE_KEY` 평문 분배 (PROJECT.md §4 의 `cp .env.local` 절차). SEC1 SEC-024 의 SOC 2 격상 | High | low | 별도 Supabase project (dev) + 별도 service_role + PROJECT.md §4 개정 (`vercel env pull` 으로 대체) | P1-S | SEC1 PR-SEC17 와 동일 |
| **SOC-011** | Change Mgmt | CC8.1 | Deploy approval gate 없음 — main merge = 자동 production deploy | High | medium | Vercel Promotions 활성 (staging-first) 또는 GitHub Action workflow_dispatch manual production gate | P1-S | CISO 결정 (속도 trade-off) |
| **SOC-012** | Change Mgmt | CC8.2 | Production rollback runbook 없음. Vercel rollback CLI + DB migration reverse 절차 미문서 | High | medium | `docs/runbook-rollback.md` + 1회 drill (preview deploy → rollback → 시간 기록) | P1-S | — |
| **SOC-013** | Change Mgmt | CC8.1 | DB migration 의 인간 review 미강제. CI naming check 만 자동 | High | medium | `docs/policy-migration-review.md` + CODEOWNERS file 에 `supabase/migrations/**` reviewer 강제 | P1-S | SOC-010 |
| **SOC-014** | Vendor Mgmt | CC9.2 | DPA 서명본 register 위치 없음. SaaS 의 통상 처리 — vendor dashboard 의 self-service signed DPA download | High | medium | 각 vendor (Vercel / Supabase / OpenAI / Anthropic / etc) dashboard 에서 signed DPA download → `vendor-dpa/` git-encrypted folder 또는 1Password vault | P1-S | SOC-004 |
| **SOC-015** | Vendor Mgmt | CC9.2 | 연 1회 vendor review cadence 없음. SOC 2 갱신 안 한 vendor 탐지 불가 | High | medium | `vendor-review/YYYY-Q1.md` 등 분기/년 schedule. critical vendor (Supabase/Vercel/OpenAI/Anthropic) 우선 | P1-S | SOC-004 |
| **SOC-016** | Incident Response | CC7.4 | on-call rotation 없음 — 단일 운영자. 부재 / 휴가 / 수면 시 대응 0 | High | high (시간 의존) | backup operator 도입 (contractor or 신규 hire) + PagerDuty / Opsgenie 또는 단순 Slack on-call schedule | P1-S | 조직적 (hire decision) |
| **SOC-017** | Monitoring | CC7.2 | audit_log 기반 자동 알림 미구성. table 만 존재 (PR #421), Slack/email 자동 emit 없음 | High | medium | `src/lib/audit.ts` 의 admin / login_failed / rate_limit_hit 이벤트 → Slack webhook (Sentry breadcrumb 와 동시) | P1-S | SOC-003 |
| **SOC-018** | Monitoring | CC7.2 | LLM 비용 anomaly detection 없음. per-user daily cost 임계 알림 없음 | Medium | high | Vercel Cron `/api/cron/llm-cost-anomaly` (1h) — 직전 1h vs 일 평균 비교 → Slack alert | P2-S | — |
| **SOC-019** | BCP/DR | A1.2 | RTO / RPO 명시 없음 | High | medium | `docs/policy-bcp.md` — RTO 4h / RPO 1h (제안) + Supabase plan 의 PITR 보유 기간 확인 | P1-S | — |
| **SOC-020** | BCP/DR | A1.2 | 분기 backup restore drill 0회 | High | medium | staging project 으로 복원 시뮬레이션 + 시간 측정 + `docs/bcp-drill-YYYY-QN.md` evidence 보관 | P1-S | SOC-019 |
| **SOC-021** | BCP/DR | A1.2 | multi-region 계획 없음 (Supabase 단일 region) | Medium | low | 1단계: 명시 region 결정 (대시보드). 2단계: read-replica 또는 EU multi-region 계획 (Pro+ tier) | P2-S | SEC1 PR-SEC11 의 region 확인 후 |
| **SOC-022** | Risk Assessment | CC3.1 | 연 1회 risk assessment cadence 없음. SEC1 / SOC2 audit 모두 1회 발생 | High | medium | `docs/policy-risk-assessment.md` — 연 1회 cadence + 분기 mini-review + 신규 vendor / 신규 피처 도입 시 trigger | P1-S | — |
| **SOC-023** | System Ops | CC7.1 / CC8.2 | Dependabot disabled + CI dep-audit non-blocking. SEC1 SEC-011 의 SOC 2 격상 | High | high | Dependabot active + `--audit-level=high` hard block + branch protection 의 required check 추가 | P1-S | SEC1 PR-SEC11 와 동일 |
| **SOC-024** | System Ops | CC7.1 | capacity planning 문서 없음. 1만 user / 10만 트래픽 대비 Vercel / Supabase / OpenAI quota 한도 분석 0 | Medium | medium | `docs/policy-capacity.md` — vendor 별 한도 + 현재 사용량 + 80% 임계 경고 | P2-S | — |
| **SOC-025** | System Ops | CC7.1 / CC2.1 | log retention policy 없음. Vercel function log / audit_log / Supabase log 보존 기간 미정의 | Medium | medium | `docs/policy-log-retention.md` — Vercel (plan-default) / audit_log (1년 + 5년 cold archive) / app log 정책 | P2-S | — |
| **SOC-026** | Provisioning | CC6.2 / CC6.5 | onboarding / role-change / offboarding checklist 없음 | High | low (인원 적음) | `docs/access-onboarding-checklist.md` + `docs/access-offboarding-checklist.md` + `docs/access-role-change.md` | P1-S | SOC-002 |
| **SOC-027** | Access Control | CC6.3 | API key rotation 정책 없음. 1년 이상 동일 키 사용 추정 | Medium | low | `docs/security-key-rotation.md` — 키 별 cadence + 회전 절차 + 침해 의심 시 즉시 회전 | P2-S | SOC-002 |
| **SOC-028** | Process | CC1.4 / CC4.1 | board / governance structure 미문서 (CISO / CEO 단일 인물). 윤리 강령 / acceptable use policy 없음 | Low | low | `docs/policy-governance.md` (single-person 조직 의 compensating control) + `docs/policy-acceptable-use.md` | P3-S | — |

---

## 2. 영역별 발견 분포

| 영역 | Critical | High | Medium | Low |
|---|:-:|:-:|:-:|:-:|
| Access Control (CC6) | 1 (SOC-002) | 2 (SOC-009, SOC-026) | 1 (SOC-027) | 0 |
| Change Management (CC8) | 1 (SOC-010) | 3 (SOC-011, SOC-012, SOC-013) | 0 | 0 |
| Vendor Mgmt (CC9) | 1 (SOC-004) | 2 (SOC-014, SOC-015) | 0 | 0 |
| Incident Response (CC7.4) | 1 (SOC-001) | 2 (SOC-007, SOC-016) | 0 | 0 |
| Monitoring (CC7.2) | 1 (SOC-003) | 2 (SOC-008, SOC-017) | 1 (SOC-018) | 0 |
| BCP / DR (A1.2) | 0 | 2 (SOC-006/019/020 중 high) | 1 (SOC-021) | 0 |
| Risk Assessment (CC3) | 0 | 1 (SOC-022) | 0 | 0 |
| System Ops (CC7.1) | 0 | 1 (SOC-023) | 2 (SOC-024, SOC-025) | 0 |
| Governance (CC1) | 0 | 0 | 0 | 1 (SOC-028) |
| Privacy (P5) | 0 | 1 (SOC-005) | 0 | 0 |
| **합계** | **5** | **15** | **5** | **1** |

(SOC-006/019/020 는 BCP 영역 안 중복 매핑 — 위 카운트는 single-attribution 으로 처리)

---

## 3. 후속 PR — PR-SEC17 ~ PR-SEC25 (SOC 2 series)

> SEC1 의 PR-SEC2~SEC16 와 번호 충돌 방지 위해 **PR-SEC17 부터 SOC 2 series 시작**. SOC-XXX 발견 ID 와 PR 번호는 분리 — 한 PR 이 여러 발견 cover 가능.

### Sprint S1 (D+1~2주) — Type 1 prerequisite

#### PR-SEC17 — Incident Response runbook + tabletop drill
- **다루는 발견**: SOC-001, SOC-007 (의 시작)
- **크기**: M (이 문서 v1 finalize + 1회 drill)
- **branch**: `docs/soc2-incident-response`
- **변경 파일**:
  - `docs/runbook-incident-response.md` (이 문서 의 §1~§11 승격, 운영 가능 형식)
  - `docs/incidents/drill-2026-MM-DD.md` (첫 tabletop drill 결과)
  - `docs/incidents/.gitkeep` (디렉토리 셋업)
- **수용 기준**: CISO sign-off + drill 1회 시행 evidence + 다음 분기 drill 일자 commit

#### PR-SEC18 — Access matrix + MFA 강제 evidence
- **다루는 발견**: SOC-002
- **크기**: M
- **branch**: `docs/soc2-access-matrix`
- **변경 파일**:
  - `docs/security-access-matrix.md` (외부 9~12 시스템 의 admin/member matrix 완성)
  - `docs/security-soc2-access-control.md` §3.1 표 채움
  - `access-evidence/2026-Q3/` 디렉토리 + 각 시스템 MFA-required screenshot
- **사전 작업**: 각 시스템 settings → "require MFA" 활성 + screenshot 캡처 (이미지 commit X — gitignore, 별 SharePoint/Drive 보관 권장)
- **수용 기준**: 매트릭스의 모든 cell 채워짐 + critical vendor (GH/Vercel/Supabase) MFA-required active

### Sprint S2 (D+2~4주) — 거버넌스

#### PR-SEC19 — Change management policy + branch protection 강화
- **다루는 발견**: SOC-010, SOC-013, SOC-019-CM (`docs/policy-change-management.md`)
- **크기**: M
- **branch**: `chore/soc2-change-policy`
- **변경 파일**:
  - `docs/policy-change-management.md` (정식 형식, security-soc2-change-management.md §4 참고)
  - `docs/policy-migration-review.md`
  - `.github/CODEOWNERS` (신규) — `supabase/migrations/** @chrislee-cmd` + `next.config.ts @chrislee-cmd` + `src/middleware.ts @chrislee-cmd` + `package.json @chrislee-cmd`
  - branch protection 갱신: `required_approving_review_count = 1`, `dismiss_stale_reviews = true`
- **caveat**: 1인 운영 단계 의 compensating control — CISO override 가능 형태 유지, post-merge review log 보존
- **수용 기준**: `gh api ...protection | jq .required_pull_request_reviews` 의 reviewer count = 1, CODEOWNERS file 존재

#### PR-SEC20 — Vendor management register + DPA collection
- **다루는 발견**: SOC-004, SOC-014, SOC-015
- **크기**: M (대부분 문서 + 외부 협의)
- **branch**: `docs/soc2-vendor-management`
- **변경 파일**:
  - `docs/policy-vendor-management.md`
  - `docs/vendors/vercel.md`, `supabase.md`, `openai.md`, `anthropic.md`, `deepgram.md`, `elevenlabs.md`, `livekit.md`, `twelvelabs.md`, `stripe.md`, `lemonsqueezy.md`, `google.md`, `notion.md`, `mixpanel.md`, `upstash.md`, `kakao.md`, `naver.md` (한 vendor = 한 markdown: DPA URL + 등급 + SOC 2 attestation + 데이터 카테고리 + 다음 review 일자 + 변경 사유)
- **수용 기준**: critical vendor 5개 (Vercel/Supabase/OpenAI/Anthropic/Stripe) 의 DPA download + 보관 위치 명시 + 다음 review 일자 commit

### Sprint S3 (D+4~6주) — 운영 통제

#### PR-SEC21 — Sentry + Slack alert + audit_log wiring
- **다루는 발견**: SOC-003, SOC-008, SOC-017 (SEC1 의 SEC-012 와 통합)
- **크기**: L
- **branch**: `feat/sentry-soc2-monitoring`
- **변경 파일**:
  - `pnpm add @sentry/nextjs`
  - `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
  - `src/lib/audit.ts` — Sentry breadcrumb 동시 emit + critical 이벤트 (admin 행위 / login_failed >5 / rate_limit_hit polarization) Slack webhook
  - `docs/policy-audit-trail.md` (어느 행위가 logged + 보존 정책)
- **수용 기준**: 의도 throw → Sentry dashboard 표시 + Slack `#alerts` channel 메시지. audit_log row 의 admin action → Slack 알림 확인. PII scrub (email/token/body) sample 10개 모두 redact 확인

#### PR-SEC22 — BCP / DR — RTO RPO 정의 + restore drill 1회
- **다루는 발견**: SOC-006, SOC-019, SOC-020
- **크기**: M (대부분 문서 + 1회 drill 실시)
- **branch**: `docs/soc2-bcp-dr`
- **변경 파일**:
  - `docs/policy-bcp.md` — RTO 4h / RPO 1h (제안 — CISO 결정)
  - `docs/bcp-drill-2026-Q3.md` — 첫 restore drill 결과
- **사전 작업**:
  - Supabase 대시보드에서 PITR 보유 기간 확인 + tier 확정
  - staging project (또는 new project) 으로 복원 시뮬레이션 → sanity SQL → 시간 측정
- **수용 기준**: drill 결과 RTO/RPO 추정치 vs 정책 ≤ 정책. evidence (시간 / 명령 / 결과) 보관

### Sprint S4 (D+6~8주) — Type 1 신청 prep

#### PR-SEC23 — Risk assessment cadence + governance policy
- **다루는 발견**: SOC-022, SOC-028
- **크기**: M
- **branch**: `docs/soc2-risk-governance`
- **변경 파일**:
  - `docs/policy-risk-assessment.md` — annual cadence + 분기 mini-review + trigger 조건 (신규 vendor / 신규 피처 / 침해)
  - `docs/policy-governance.md` — single-person 조직 의 compensating control
  - `docs/policy-acceptable-use.md` — 직원 / contractor / agent (Claude Code 포함) 의 use policy

#### PR-SEC24 — Dependabot + dep-audit hard block (SEC1 PR-SEC11 와 통합)
- **다루는 발견**: SOC-023 (SEC-011)
- **크기**: S
- **branch**: `chore/dep-audit-hard-block`
- **변경 파일**:
  - `.github/dependabot.yml` (신규)
  - `.github/workflows/ci.yml` — `dep-audit` job 의 `continue-on-error: true` 제거
  - branch protection 의 required checks 에 `Dependency audit` 추가
- **사전 작업**: 현재 CVE 12 high 해소 (next 16.2.5 upgrade + transitive)
- **수용 기준**: pnpm audit --audit-level=high 통과 + Dependabot security update 1주 watch

#### PR-SEC25 — Onboarding / offboarding checklist + key rotation policy
- **다루는 발견**: SOC-026, SOC-027
- **크기**: M
- **branch**: `docs/soc2-provisioning-checklist`
- **변경 파일**:
  - `docs/access-onboarding-checklist.md`
  - `docs/access-offboarding-checklist.md`
  - `docs/access-role-change.md`
  - `docs/security-key-rotation.md`
- **수용 기준**: 4 markdown 작성 + CISO sign-off

### Sprint S5 (D+8~10주) — Type 1 audit period

#### PR-SEC26 — Dev secret 격리 (SEC1 PR-SEC17 와 통합)
- **다루는 발견**: SOC-009 (SEC-024)
- **크기**: L
- **branch**: `chore/dev-secret-isolation`
- **변경 파일**:
  - 별도 Supabase project (`ai-researcher-dev`) 생성 (외부 작업)
  - `.env.local.example` 갱신 (모든 env 문서)
  - `PROJECT.md §4 합류 절차` 개정 — `vercel env pull` (dev project) 사용
  - secret manager 도입 평가 (1Password CLI / Doppler / Vercel CLI) 결과 문서

#### PR-SEC27 — Capacity / log retention policy + LLM cost anomaly
- **다루는 발견**: SOC-018, SOC-024, SOC-025, SOC-021
- **크기**: M
- **branch**: `docs/soc2-ops-policies`
- **변경 파일**:
  - `docs/policy-capacity.md`
  - `docs/policy-log-retention.md`
  - `src/app/api/cron/llm-cost-anomaly/route.ts` (신규) — 1h 주기, Slack 알림
  - `vercel.json` cron 추가

---

## 4. 의존성 그래프

```
SOC-001 (IR runbook) ────────────────────────────┐
                                                  ├─→ SOC-007 (post-mortem evidence)
SOC-003 (Sentry) ────────────────────────────────┤
                                                  ├─→ SOC-017 (audit_log alerting)
SOC-002 (access matrix) ─────────────────────────┤
                                                  ├─→ SOC-026 (onboarding/offboarding)
SOC-004 (vendor register) ───────────────────────┼─→ SOC-014/15 (DPA + review cadence)
                                                  │
SOC-010 (branch protection) ─────────────────────┼─→ SOC-013 (migration review)
                                                  │   SOC-011 (deploy approval)
                                                  │
SOC-016 (backup operator) — 조직적 ──────────────┼─→ SOC-010 의 enforce_admins flip 가능
                                                  │
SOC-019 (RTO/RPO) ───────→ SOC-020 (restore drill)
                                                  │
SOC-022 (risk cadence) — 독립
SOC-023 (Dependabot) — 독립 (SEC-011 동일)
SOC-009 (dev secret) — 독립 (SEC-024 동일)
SOC-018 (LLM cost anomaly) — 독립
```

---

## 5. SEC1 (GDPR/OWASP) 발견 의 SOC 2 통합 매핑

| SEC1 ID | 머지 상태 | SOC 2 의 동일 / 인접 발견 | 비고 |
|---|---|---|---|
| SEC-001 (open-redirect) | ✅ PR #419 머지 | (CC6.6) | resolved |
| SEC-002 (보안 헤더) | ✅ PR #424 머지 | (CC6.7) | resolved |
| SEC-003 (rate limit) | ✅ PR #422 머지 | (CC6.6 / CC6.8) | resolved |
| SEC-004 (account delete) | ✅ PR #428 머지 | (P5) | resolved |
| SEC-005 (account export) | ✅ PR #427 머지 | (P5) | resolved |
| SEC-006 (동의 수집) | ✅ PR #421 머지 | (P2) | resolved |
| SEC-007 (Mixpanel gate) | ✅ PR #426 머지 | (P3) | resolved |
| SEC-008 (ROPA/DPIA/audit_log) | 🟡 PR #421 partial (audit_log infra) | SOC-008 (audit_log policy) | partial — ROPA/DPIA 문서 미 |
| SEC-009 (prompt injection) | 🔴 open | (CC6.7 / PI1.2) | PR-SEC9 미 |
| SEC-010 (OAuth 평문) | 🔴 open | (C1.1) | PR-SEC13 미 |
| SEC-011 (dep-audit) | 🔴 open | **SOC-023** (동일) | PR-SEC11 / SEC24 통합 |
| SEC-012 (Sentry) | 🔴 open | **SOC-003** (동일, 격상) | PR-SEC12 / SEC21 통합 |
| SEC-013 (admin audit) | 🟡 partial | SOC-008, SOC-017 | PR-SEC12 미 |
| SEC-014 (국제 전송) | 🔴 open | SOC-004 / SOC-014 (vendor) | PR-SEC11 미 |
| SEC-015 (retention cron) | ✅ PR #428 머지 | (P4) | resolved |
| SEC-016 (tax_invoice) | 🔴 open | (C1.1) | PR-SEC13 미 |
| SEC-017 (mammoth XSS) | 🔴 open | (CC6.7 / PI1.2) | PR-SEC14 미 |
| SEC-018 (file upload MIME) | 🔴 open | (CC6.7 / PI1.2) | PR-SEC14 미 |
| SEC-019 (login rate-limit) | ✅ PR #422 통합 | (CC6.6) | resolved |
| SEC-020 (멤버 제거 세션) | 🔴 open | (CC6.5) | PR-SEC16 미 |
| SEC-021 (voice retention) | ✅ PR #428 통합 | (P4) | resolved |
| SEC-022 (privacy v2) | 🔴 open | (P2) | PR-SEC15 미 |
| SEC-023 (CORS) | 🔴 open | (CC6.7) | P3, 후순위 |
| SEC-024 (dev secret) | 🔴 open | **SOC-009** (동일, 격상) | PR-SEC17 / SEC26 통합 |
| SEC-025 (consent audit) | ✅ PR #421 통합 | (P2) | resolved |
| SEC-026 (incident response) | 🔴 open | **SOC-001** (동일, 격상) | PR-SEC17 통합 (SOC 2 series 의 first) |
| SEC-027 (cookie banner) | ✅ PR #426 통합 | (P2) | resolved |
| SEC-028 (voice tool) | 🔴 open | (CC6.7 / PI1.2) | PR-SEC16 미 |

**SEC1 28건 중 13건 resolved, 15건 open**. SOC 2 의 26건 중 6건은 SEC1 의 open 발견과 동일/통합 가능 → 실 신규 SOC 2 작업은 **20건** (=26 - 6).

---

## 6. Type 1 → Type 2 timeline 권장

```
2026-06-26 (오늘)
├─ Phase 0: SEC1 audit (28 발견, P0 7 fixed via PR-SEC2~SEC8)
└─ SOC 2 audit (이 문서, 26 발견)
       │
       ▼
2026-07-01 ~ 2026-08-31 (Sprint S1~S4, 8주)
├─ PR-SEC17 ~ PR-SEC25 (SOC 2 series) + SEC1 open 잔여
├─ 외부 협의: vendor DPA collection, backup operator hire
└─ 1회 tabletop drill (SOC-001 evidence)
       │
       ▼
2026-09-01 (Type 1 audit 신청 가능 시점)
├─ KPMG / Deloitte / EY / 삼정 / Vanta 선정
└─ 1~2주 검수 → Type 1 보고서
       │
       ▼
2026-09-30 ~ 2027-03-31 (Type 2 운영 evidence 누적 6mo+)
├─ 매월 access review log
├─ 매분기 restore drill log (S3, S4)
├─ 매분기 tabletop drill log
├─ 자동 alert / Sentry / audit_log 의 continuous evidence
├─ 발생한 incident 별 post-mortem
└─ vendor review 1회 (annual)
       │
       ▼
2027-04-01 ~ 2027-06-30 (Type 2 audit period)
├─ audit firm 의 분기 evidence 샘플링
└─ Type 2 보고서 (1년치 control 운영 의 effectiveness)
       │
       ▼
2027-07-01 (SOC 2 Type 2 attestation 보유)
└─ enterprise RFP / EU launch 시 사용 가능
```

---

## 7. CISO 검토 시 권장 의사결정 항목

다음은 spec writer → jarvis launch 전에 CISO (chrislee) 가 결정해야 할 항목:

1. **backup operator** — contractor / 신규 hire? 시점 / 예산?
2. **deploy approval gate** — Vercel Promotions vs staging-first vs current. 속도 trade-off 수용?
3. **`enforce_admins` flip 시점** — backup operator 도입 후?
4. **Sentry plan** — Team \$26/mo vs Business \$80/mo (PII scrub + data retention)
5. **PagerDuty / Opsgenie** — 시점 / 예산?
6. **Type 1 audit firm 선정** — KPMG vs Deloitte vs Vanta (SaaS-specialized, 자동화 강함, 저렴)
7. **cyber liability 보험** — 검토 시점?
8. **외부 DPO consultant** — SEC1 PR-SEC11 와 동시 / 별 retainer?
9. **commit signing** — 도입 / skip?
10. **OAuth 토큰 암호화 (SEC-010)** — pgsodium 도입 시점 (Sprint S3 vs S5)?

---

## 8. 사용 가이드

1. **CISO 검수 시**: §1 매트릭스의 ID / 영역 / 등급 / 권장 3컬럼만 보여줘도 충분. CISO sign-off → §7 의사결정 답변 commit
2. **spec writer 가 후속 PR spec 작성 시**: §3 의 PR-SEC17~SEC27 의 본문을 SSOT spec 으로 분해 (`~/jarvis/workspaces/product-2/ai-researcher/tasks/`)
3. **사후 audit (3~6mo)**: 동일 ID 로 status 갱신. resolved 는 별도 RESOLVED 컬럼
4. **Type 1 audit firm review 시**: §6 timeline 으로 진행 상황 시각화

---

## 9. 결론

**26 발견 / 5 Critical / 12 High / 7 Medium / 1 Low**. Sprint S1~S4 (8주) 머지 + 1회 tabletop drill + 1회 restore drill + vendor DPA collection 만 완료해도 **Type 1 audit 통과 가능 (2026 Q4)**. Type 2 는 control 운영 시작 후 **최소 6개월 evidence 누적** 필요 — 빠르면 **2027 Q2~Q3 attestation 보유 가능**. SEC1 의 15 open 발견 중 SEC-011/012/024/026 4건이 SOC 2 발견과 통합 가능 → 실 신규 작업 분량은 **PR 약 10~12개**.
