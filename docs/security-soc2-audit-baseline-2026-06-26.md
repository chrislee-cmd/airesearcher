# SOC 2 gap audit — Phase 0 보강 보고서

- **버전**: 1.0 (2026-06-26)
- **범위**: ai-researcher repo `main` HEAD `d63714f`. SEC1 의 GDPR/OWASP 진단 위에 **SOC 2 운영 통제 (operational controls)** 영역을 보강
- **방식**: read-only audit (코드 변경 0건)
- **선행 문서** (SEC1):
  - `docs/security-audit-baseline-2026-06-26.md` — 28 발견의 보안 baseline
  - `docs/security-audit-data-flow.md` — 외부 처리자 데이터 흐름
  - `docs/security-audit-risk-matrix.md` — 발견 ID·등급·우선순위
  - `docs/security-audit-followups.md` — PR-SEC2 ~ PR-SEC17
- **이 audit 의 동반 문서**:
  - `docs/security-soc2-access-control.md` — CC6 권한·MFA·offboarding 상세
  - `docs/security-soc2-change-management.md` — CC8 PR/배포/마이그 절차 상세
  - `docs/security-soc2-incident-response.md` — CC7.4 인시던트 runbook 초안
  - `docs/security-soc2-risk-matrix.md` — SOC 2 영역별 위험 + 후속 PR

---

## 0. Executive Summary (CISO 5분 브리핑)

**판정 — "기술 통제는 강하나, 운영 거버넌스가 미문서화."**

SEC1 audit 이후 4주간 P0 7건 중 7건 fix 머지 완료 (open-redirect / 보안 헤더 / rate limit / 동의 + audit_log / 계정 삭제 + retention / 계정 export / Mixpanel gate). 같은 시기 SOC 2 운영 통제 9 영역을 별도 점검한 결과, **기술적 통제 (preventive)** 는 SaaS 대비 평균 이상이나 **관리적 통제 (administrative) + 탐지·대응 통제 (detective/responsive)** 가 거의 비어 있음 — Type 1 audit 통과 위해 4~6주, Type 2 통과 위해 6개월 이상 운영 evidence 누적 필요.

**5 TSC 통과 가능성 (현재 시점 Type 1 가정)**:

| TSC | Type 1 | Type 2 (6mo+ evidence) | 차단 사유 |
|---|:-:|:-:|---|
| Security (Common Criteria) | **부분** | **불가** | audit_log 운영 evidence 부족, 사고 대응 runbook 무 |
| Availability | **불가** | **불가** | RTO/RPO 미정의, backup restore drill 0회 |
| Processing Integrity | 부분 | 부분 | 데이터 검증은 zod 광범위, 변경 traceability 부분 |
| Confidentiality | 부분 | 부분 | OAuth 토큰 / tax_invoice 평문 (SEC-010/016) 잔존 |
| Privacy | 부분 | 부분 | SEC1 P0 7건 fix 완료, ROPA·DPIA·정책 v2 미완 |

**9 운영 통제 영역 — Pass / Gap / Critical Gap 평가**:

| 영역 | TSC | 현재 상태 | 등급 |
|---|---|---|:-:|
| 1. Access Control | CC6 | RLS·service_role 격리 강함. 외부 서비스 (GH/Vercel/Supabase) 의 MFA·정기 권한 review·offboarding 절차 0 | **Critical Gap** |
| 2. Change Management | CC8 | PR + status check + linear history + gitleaks + design-system lint 강제. but `required_approving_review_count = 0`, admin bypass 가능, commit signing 미사용 | **Critical Gap** |
| 3. Vendor Management | CC9 | 14+ 처리자 매핑 (SEC1 data-flow.md). but DPA 서명본 register / 연 1회 review / 등급 분류 없음 | **Gap** |
| 4. Incident Response | CC7.4 | 무 — runbook·SLA·post-mortem·on-call 모두 0 | **Critical Gap** |
| 5. Monitoring & Alerting | CC7.2 | audit_log 테이블 + Vercel function log 만. Sentry 0, 알림 0, SIEM 0 | **Critical Gap** |
| 6. BCP / DR | A1.2 | Supabase 자동 backup 의존 (보유 기간 unverified), restore drill 0회, RTO/RPO 미정의 | **Gap** |
| 7. Risk Assessment | CC3 | SEC1 risk matrix 1회 작성. 연 1회 cadence 정의 없음 | **Gap** |
| 8. System Operations | CC7.1 | Vercel default + Husky/CI guards 만. dep audit non-blocking (SEC-011). capacity / anomaly / patch policy 0 | **Gap** |
| 9. Logical Access Provisioning | CC6.2 | onboarding / role change / permission matrix 무문서 | **Critical Gap** |

**점수 — 5 Critical Gap / 4 Gap / 0 Pass**.

**CISO·SOC 2 auditor 의 가장 큰 우려 (예상)**:
> "기술 control 은 RLS / pre-commit / CI / branch protection 으로 SaaS 평균을 상회. 그러나 audit firm 이 요구할 **operating effectiveness evidence (Type 2)** — 인시던트 대응 기록, 정기 권한 review 결과, vendor DPA 서명본, backup restore drill 결과 — 가 전무. Type 1 (point-in-time control design) 은 PR-SEC17~PR-SEC25 시퀀스로 4~6주 안에 도달 가능. Type 2 는 control 운영 6개월+ evidence 필요해 빠르면 2026 Q4 ~ 2027 Q1."

**Type 1 통과 위한 즉시 조치 (P0-S, "S" = SOC 2 series 의미)**:
- `SOC-001` 인시던트 대응 runbook + 통보 SLA 문서화 (`security-soc2-incident-response.md` 의 초안 → 실 운영)
- `SOC-002` GitHub/Vercel/Supabase 의 **사용자 권한 매트릭스 + MFA 강제 정책 + offboarding 절차** 문서
- `SOC-003` Sentry 도입 + audit_log 알림 (이미 SEC-012 로 추적, SOC 2 관점에서 Type 2 evidence 의 핵심)
- `SOC-004` Vendor DPA register + 연 1회 review schedule 문서

**Type 2 통과 위한 후속 조치 (P1-S)**:
- `SOC-005` 분기별 권한 review 운영 (실 행위 → 결과 보관)
- `SOC-006` 분기별 backup restore drill (실 복원 → 시간 기록 → restore-readiness 증명)
- `SOC-007` 인시던트 발생 시 post-mortem 작성·보관 (실 발생 evidence)
- `SOC-008` 사용자/사내 access change 의 audit_log 로 6mo+ 보존

---

## 1. SOC 2 framework 개요 (SaaS / 비개발자 동시 참고)

SOC 2 (Service Organization Control 2) 는 **AICPA** 가 정의한 SaaS 보안·운영 통제 표준. 5 Trust Service Criteria (TSC) 로 구성:

| TSC | 약어 | 무엇을 평가하나 | 우리에게 필수? |
|---|---|---|:-:|
| **Security** | CC (Common Criteria) | 무단 접근·변조 차단, 인증/인가/감사/사고대응 | ✅ 필수 |
| **Availability** | A1 | 약속한 SLA / uptime, BCP/DR | ✅ EU launch / B2B contract 시 요구 |
| **Processing Integrity** | PI1 | 데이터 처리의 완전성·정확성·timeliness | ⚠ B2B 분석 SaaS 라 필수에 가까움 |
| **Confidentiality** | C1 | 비공개 데이터의 비밀 유지 | ⚠ 다수 enterprise 고객이 요구 |
| **Privacy** | P1~P8 | 개인정보의 수집·보관·사용·처분 — GDPR 와 cross-reference | ✅ EU launch 필수 |

**Common Criteria** 는 9 series (CC1~CC9) 로 세분:
- **CC1 — Control Environment**: 책임 구조 + tone-at-the-top + 윤리 강령
- **CC2 — Communication**: 정책 전파 + 변경 통지
- **CC3 — Risk Assessment**: 정기 위험 평가 + 이슈 식별
- **CC4 — Monitoring Activities**: 통제 운영 monitoring + 결함 시정
- **CC5 — Control Activities**: 일반·기술 통제 (encryption, access control, etc.)
- **CC6 — Logical & Physical Access**: 인증·인가·물리·논리 접근
- **CC7 — System Operations**: monitoring·incident response·BCP
- **CC8 — Change Management**: 모든 변경의 안전한 처리
- **CC9 — Risk Mitigation**: vendor risk + risk transfer (보험 등)

**Type 1 vs Type 2**:
- **Type 1** = 특정 시점 (e.g., 2026-12-31 기준) 의 control **design** 검증. 정책 문서 + 통제 in-place 확인. 통상 1~2주 검수
- **Type 2** = 6~12개월간 control 의 **operating effectiveness** 검증. 실 운영 evidence (로그·티켓·결과물) 샘플링. 통상 audit firm 이 분기마다 데이터 수집

**audit firm 예시** (한국): KPMG, EY, Deloitte, 삼정. **비용 추정**: Type 1 \$30~50k, Type 2 \$60~100k + 내부 작업 6~12개월.

---

## 2. 9 운영 통제 영역 상세 평가

### 2.1 Access Control (CC6) — **Critical Gap**

> **상세는** `docs/security-soc2-access-control.md`. 여기서는 평가 요약만.

**점검 대상**: 코드 외부의 시스템 — GitHub, Vercel, Supabase, OpenAI, Anthropic, Deepgram, ElevenLabs, LiveKit, Twelvelabs, Stripe, Lemon Squeezy, Google Cloud, Notion, Mixpanel, gitleaks, Sentry (예정), Cloudflare (예정).

**현재 상태**:
- ✓ **DB / 어플리케이션 레벨**: 110 route auth gate, 40+ 테이블 RLS, service_role 노출 0 (SEC1 §3 PASS)
- ✗ **외부 서비스 admin 권한**: 누가 GH org admin / Vercel Owner / Supabase Owner 인지 register 없음
- ✗ **MFA 강제**: GH 의 require-MFA org setting / Vercel SAML SSO / Supabase TOTP 활성 여부 미확인
- ✗ **shared account**: PROJECT.md §4 의 `cp .env.local` 절차로 모든 worker 머신에 동일 `SUPABASE_SERVICE_ROLE_KEY` 존재 → SEC-024 (RLS 우회 가능한 단일 평문 키 다수 머신 공유)
- ✗ **periodic review**: 분기별 또는 연 1회 cadence 없음. CISO 이임/입사 시 절차 없음
- ✗ **offboarding**: 직원 떠날 때 권한 회수 checklist 없음

**SOC 2 영향**: CC6.1, CC6.2, CC6.3 모두 fail likely. Type 1 통과 위해 정책 문서 + 권한 매트릭스 작성 필수.

**판정**: **Critical Gap** — 발견 `SOC-002` (P0-S), `SOC-009` (P1-S, dev secret 격리는 SEC-024 의 SOC 2 표면)

---

### 2.2 Change Management (CC8) — **Critical Gap**

> **상세는** `docs/security-soc2-change-management.md`.

**현재 상태** (강함 + 약함 혼재):
- ✓ **PR 강제**: branch protection on `main` → 직접 push 금지
- ✓ **Linear history**: `required_linear_history: true` → squash merge 강제
- ✓ **status check 3종**: `Lint + Typecheck`, `Secrets scan`, `Vercel` — strict (up-to-date) 강제
- ✓ **husky pre-commit**: `.env*` 차단 + `messages/*.json` parse + gitleaks staged + migration naming + lint-staged
- ✓ **husky commit-msg**: `feat|fix|chore|hotfix` prefix 강제
- ✓ **CI gitleaks** (`secrets-scan` job, fetch-depth: 0 → 전체 commit history)
- ✓ **CI design-system lint** + **CI full lint** + **CI typecheck**
- ✓ **CI migration naming** (14자리 timestamp prefix 강제, SEC §7.9 함정 회피)
- ✗ **`required_approving_review_count: 0`** → 코드 작성자 ≠ approver 분리 (segregation of duties) **미강제**
- ✗ **`enforce_admins: false`** → admin (chrislee-cmd) 가 branch protection 우회 가능
- ✗ **`required_signatures: false`** → commit 서명 미강제 → spoofing 표면
- ✗ **deploy approval**: Vercel production deployment 의 manual approval gate 없음 (main merge → 자동 production)
- ✗ **rollback runbook**: Vercel "Promote to Production" / `vercel rollback` 절차 문서 없음
- ✗ **DB migration 검토**: CI naming check 만 자동. 인간 검토 의무 명시 X (PROJECT.md §3.5 의 commit 직전 self-check 만)
- ✗ **CI `pnpm audit` non-blocking** (SEC-011) → 알려진 CVE 통과
- ⚠ **audit_log 테이블** 은 존재 (`20260626020922_audit_log.sql`) but 정책 매핑 (어떤 변경이 logged 되는지) 미문서화

**SOC 2 영향**: CC8.1 (change authorization)·CC8.2 (change implementation)·CC8.3 (emergency change) — 부분 통과. Type 1 위해 정책 문서 + segregation of duties 강제 필요.

**판정**: **Critical Gap** — 발견 `SOC-010`~`SOC-013` (P1-S, branch protection 강화 / 배포 approval / rollback runbook / migration review policy)

---

### 2.3 Vendor Management (CC9) — **Gap**

**현재 상태**:
- ✓ **vendor 매핑 존재** — SEC1 `docs/security-audit-data-flow.md` §4 가 14+ 처리자 전부 카테고리·데이터·DPA·EU 적합성 4컬럼 정리
- ⚠ **각 vendor 의 SOC 2 attestation 확인**: 코드/문서에 evidence 없음. SaaS 대상 vendor 의 통상 상태:
  - Vercel — SOC 2 Type 2 ✅ (공개)
  - Supabase — SOC 2 Type 2 ✅ (공개)
  - OpenAI — SOC 2 Type 2 ✅ (enterprise tier)
  - Anthropic — SOC 2 Type 2 ✅
  - Deepgram — SOC 2 Type 2 ✅
  - ElevenLabs — SOC 2 Type 2 ✅
  - LiveKit Cloud — SOC 2 Type 2 ✅
  - Twelvelabs — SOC 2 Type 2 (확인 필요)
  - Stripe — SOC 2 Type 2 ✅
  - Lemon Squeezy — SOC 2 Type 2 (확인 필요, Stripe processor 기반)
  - Google Cloud (Forms/Sheets/Docs OAuth) — SOC 2 Type 2 ✅
  - Notion — SOC 2 Type 2 ✅
  - Mixpanel — SOC 2 Type 2 ✅
  - Sentry (도입 예정) — SOC 2 Type 2 ✅
  - Upstash Redis (SEC4 가 추가 — SOC 2 ✅)
  - Cloudflare (도입 예정) — SOC 2 Type 2 ✅
  - 한국 Kakao / Naver OAuth — 자체 PIPA / ISO 27001 (KISA 인증)
- ✗ **DPA 서명본 register**: 각 vendor 의 dashboard 에서 DPA download/sign 한 PDF 보관 위치 없음
- ✗ **연 1회 vendor review 절차**: cadence 없음. vendor 가 SOC 2 갱신 안 한 경우 탐지 불가
- ✗ **vendor risk tier 분류**: critical (Supabase / Vercel / OpenAI / Anthropic) vs non-critical (Mixpanel / Sentry) 차등 review 없음
- ✗ **incident-by-vendor 통보 채널**: Supabase outage 시 누가 우리에게 어떻게 통지? unsubscribed status page 의존

**SOC 2 영향**: CC9.2 (vendor risk management) — partial. Type 2 위해 매년 vendor review 의 evidence 누적 필요.

**판정**: **Gap** — 발견 `SOC-014`, `SOC-015` (P1-S, vendor DPA register / 연 review cadence)

---

### 2.4 Incident Response (CC7.4) — **Critical Gap**

> **상세는** `docs/security-soc2-incident-response.md` (runbook 초안 + 템플릿).

**현재 상태**: **무**.
- ✗ 인시던트 정의·분류 (Critical / High / Medium / Low) 없음
- ✗ 응답 절차 (detect → triage → contain → resolve → post-mortem) 없음
- ✗ 통보 SLA 매트릭스 (사용자 / 규제 / vendor) 없음. GDPR Art. 33 의 72시간 통지 의무 → 우리 code 안에 자동 알림 X
- ✗ post-mortem 템플릿 / 보관 위치 없음
- ✗ runbook (자주 발생 시나리오 — DB 다운, LLM 비용 폭주, OAuth provider 장애, transit 한 가입자 spam) 없음
- ✗ on-call rotation: 단일 운영자 (chrislee) → 부재 시 대응 0
- ⚠ **현재 사실상의 IR**: chrislee 의 직접 인지 + 즉석 fix. 1만 user 시점에는 부족

**SOC 2 영향**: CC7.4 (incident response) — fail. Type 1 위해 runbook 문서, Type 2 위해 실 인시던트 처리 evidence 6mo+ 누적.

**판정**: **Critical Gap** — 발견 `SOC-001` (P0-S, runbook 작성), `SOC-016` (P1-S, on-call rotation 또는 backup operator)

---

### 2.5 Monitoring & Alerting (CC7.2) — **Critical Gap**

**현재 상태**:
- ✓ **`audit_log` 테이블** (SEC1 `20260626020922_audit_log.sql`) — 변경/admin 행위 일부 logging
- ✓ **rate limit hit** — SEC4 의 Upstash 카운터 + 429 응답
- ✗ **Sentry / error tracking 0** (SEC-012 잔존) → production 사고 invisible
- ✗ **알림**: 다중 로그인 실패 / 비정상 트래픽 / admin abuse / LLM 비용 spike → 자동 알림 0
- ✗ **SIEM**: Splunk / Datadog / Elastic / Sumo Logic — 미사용. Vercel function log 보존 기간 = Pro tier 7일 (default)
- ✗ **dashboard**: security 관점의 통합 dashboard 없음 (PagerDuty / Slack webhook / GitHub Issues 없음)

**SOC 2 영향**: CC7.2 (system monitoring) — fail. SEC1 §8 의 D 평가 그대로 적용.

**판정**: **Critical Gap** — 발견 `SOC-003` (P0-S, Sentry 도입은 SEC-012 와 동일), `SOC-017` (P1-S, audit_log 기반 알림), `SOC-018` (P2-S, LLM 비용 anomaly detection)

---

### 2.6 BCP / DR (A1.2) — **Gap**

**현재 상태**:
- ⚠ **Supabase 자동 backup**: Free tier 7일 PITR (point-in-time recovery), Pro tier 7~28일. **현재 plan 미확인** (SEC1 의 region 확인과 동시 점검 필요)
- ✗ **RTO (Recovery Time Objective)**: 명시 없음 — "주말 DB 다운 시 몇 시간 안에 복원" 약속 없음
- ✗ **RPO (Recovery Point Objective)**: 명시 없음 — "최대 N분 데이터 손실 허용" 정의 없음
- ✗ **backup restore drill**: 실 backup 으로 staging 복원 + sanity SQL 수행 → 0회
- ✗ **region failover**: Supabase 단일 region (현 us-east-1 추정) → region outage 시 대응 0
- ⚠ **Vercel rollback**: dashboard 또는 `vercel rollback` 가능. 절차 미문서
- ✗ **Storage backup**: `audio-uploads` / `video-uploads` bucket 의 백업 정책 미확인

**SOC 2 영향**: A1.2 (availability — disaster recovery) — fail.

**판정**: **Gap** — 발견 `SOC-019` (P1-S, RTO/RPO 정의), `SOC-020` (P1-S, 분기별 restore drill), `SOC-021` (P2-S, multi-region 계획)

---

### 2.7 Risk Assessment (CC3) — **Gap**

**현재 상태**:
- ✓ **SEC1 risk-matrix** 1회 작성 (2026-06-26) — 28 발견, OWASP/GDPR 매핑
- ✗ **연 1회 cadence**: 정의 없음. SOC 2 는 annual risk assessment 의무
- ✗ **위험 수용 / 완화 / 회피 결정 문서**: 각 발견에 대한 manage 의사결정 (e.g., "SEC-024 = accept until Q4 2026" — written rationale) 없음
- ✗ **신규 위험 식별 절차**: 분기 review / 신규 vendor / 신규 피처 도입 시 risk 평가 필수성 미문서

**SOC 2 영향**: CC3.1, CC3.2, CC3.4 — partial. Type 1 위해 risk assessment policy 문서, Type 2 위해 annual cycle 1회 이상 evidence.

**판정**: **Gap** — 발견 `SOC-022` (P1-S, annual risk assessment policy + cadence)

---

### 2.8 System Operations (CC7.1) — **Gap**

**현재 상태**:
- ✓ **CI pipeline**: lint / typecheck / design-system / secrets-scan / dep-audit (non-blocking) / Vercel preview build
- ✓ **husky pre-commit** + `core.hooksPath` 자동 셋업
- ✓ **CI status check** 3종 strict
- ⚠ **dep-audit non-blocking** (SEC-011) → 알려진 CVE 통과
- ✗ **capacity planning**: 1만 user / 10만 트래픽 대비 — Vercel / Supabase / OpenAI quota 한도 분석 없음
- ✗ **anomaly detection**: Vercel 자동 monitoring 의존. 어플리케이션 anomaly (예: 1 user 가 1분에 1000 LLM 요청) 의 자동 탐지 없음
- ✗ **log retention policy**: Vercel function log 보존 (plan-dependent), `audit_log` 보존 (정책 미정), Supabase Postgres log 보존 미정
- ✗ **patch management**: Dependabot disabled, `pnpm audit` non-blocking → 정기 업데이트 PR 자동화 없음

**SOC 2 영향**: CC7.1 (system monitoring / operations) — partial.

**판정**: **Gap** — 발견 `SOC-023` (P1-S, Dependabot 활성 + dep-audit hard-block), `SOC-024` (P2-S, capacity planning 문서), `SOC-025` (P2-S, log retention policy)

---

### 2.9 Logical Access Provisioning (CC6.2) — **Critical Gap**

**현재 상태**:
- ✗ **onboarding 절차**: 직원 입사 → 어느 시스템 (GH org / Vercel team / Supabase org / Slack / Linear / 1Password / VPN / 도메인) 권한 부여 — 체크리스트 없음
- ✗ **role change**: 역할 변동 (e.g., dev → admin) 시 권한 추가/제거 절차 없음
- ✗ **permission matrix**: 역할 별 (CEO / CTO / Dev / Designer / Contractor) 각 시스템 권한 mapping 없음
- ✗ **offboarding**: 직원 떠날 때 권한 회수 + key rotation + 진행 중 작업 인계 — 체크리스트 없음
- ⚠ **현재 실태**: 단일 운영자 (chrislee) + 가끔 contractor — 권한 부여/회수가 manual + ad-hoc

**SOC 2 영향**: CC6.2 (user access provisioning) — fail.

**판정**: **Critical Gap** — 발견 `SOC-002` (P0-S, 위 CC6 과 묶음) + 별도 `SOC-026` (P1-S, onboarding/offboarding checklist 작성)

---

## 3. SOC 2 5 TSC 와 9 영역 매트릭스

| 영역 | Security (CC) | Availability (A1) | Proc.Integrity (PI1) | Confidentiality (C1) | Privacy (P) |
|---|:-:|:-:|:-:|:-:|:-:|
| 1. Access Control | CC6.1~6.3 | — | — | C1.1 | P5 |
| 2. Change Management | CC8.1~8.3 | A1.2 | PI1.2 | — | — |
| 3. Vendor Management | CC9.2 | A1.2 | — | C1.1 | P5 |
| 4. Incident Response | CC7.4 | A1.3 | — | — | P6 |
| 5. Monitoring | CC7.2 | A1.2 | PI1.5 | — | — |
| 6. BCP / DR | — | A1.2~1.3 | — | — | — |
| 7. Risk Assessment | CC3.1~3.4 | — | — | — | — |
| 8. System Ops | CC7.1, CC7.5 | A1.1 | PI1.4 | — | — |
| 9. Logical Provisioning | CC6.2 | — | — | C1.1 | P5 |

SEC1 audit 의 28 발견은 거의 대부분 CC5 (control activities) / CC6 (logical access) / CC7 (system ops) / P (privacy) 의 **technical control design** 결함. 이 SOC 2 audit 은 **CC1 control environment / CC2 communication / CC3 risk assessment / CC4 monitoring activities / CC7.4 incident / CC8 change / CC9 vendor / A1 availability** 의 **관리적·운영적 통제 결함** 을 보완.

---

## 4. Type 1 통과 가능성 (현재 시점)

audit firm 의 Type 1 검수 절차 — 단순화:
1. 정책 문서 review (security policy / acceptable use / access control / change management / IR / BCP)
2. 통제 운영 in-place 확인 (인터뷰 + dashboard 화면 캡처)
3. 시스템 walkthrough — 1~2 개 변경의 PR → CI → deploy → monitor 흐름 따라가기
4. exception 발견 시 management response 요청

**현재 우리 상태 (Type 1)**:

| 검수 항목 | 현재 | Type 1 통과 ? |
|---|---|:-:|
| 정책 문서 (security / IR / BCP / vendor) | **무** | ❌ |
| 권한 매트릭스 | **무** | ❌ |
| change management policy 문서 | **무** (PROJECT.md 의 §3 이 사실상 policy 지만 SOC 2 정식 형식 X) | ⚠ |
| Branch protection + status check | **있음** | ✅ |
| Pre-commit / CI gates | **있음** | ✅ |
| MFA 강제 (GH/Vercel/Supabase) | **확인 불가** | ⚠ |
| RLS + service_role 격리 | **있음** | ✅ |
| audit_log 테이블 | **있음** | ✅ |
| error tracking (Sentry 등) | **무** | ❌ |
| backup 정책 / RTO RPO | **무** | ❌ |
| 인시던트 응답 runbook | **무** | ❌ |
| vendor DPA register | **무** | ❌ |
| risk assessment 문서 + cadence | **1회 only, cadence 없음** | ⚠ |

**판정**: Type 1 fail likely. **PR-SEC17~PR-SEC25** 시퀀스로 4~6주 안에 통과 가능 (`docs/security-soc2-risk-matrix.md` §3 참고).

---

## 5. Type 2 통과 가능성 (6~12개월 후)

Type 2 는 **operating effectiveness** — 단순 design 만 보지 않고 6~12개월 실 운영 evidence 샘플링:
- 매월 access review 결과 (e.g., 4분기 review log 4건)
- 매월 patch 적용 PR 기록 (Dependabot PR 12개)
- 매분기 backup restore drill 결과 (4회)
- 발생한 인시던트 별 post-mortem (모든 incident severity 분류 + 통보 SLA 준수 evidence)
- audit_log 의 admin 행위 6mo+ continuous logging
- vendor DPA review 1회 + 결과 문서
- 매년 risk assessment 1회 + 결과 + management response

**판정**: Type 2 는 control 작동 시작 후 **최소 6개월** 누적 evidence 필요. PR-SEC17~SEC25 머지 + 운영 시작 시점에서 6개월 후 (2027 Q1 ~ Q2) audit 신청 권장. 단 Type 1 을 2026 Q4 에 받아두면 enterprise 고객 RFP 응답 시 사용 가능.

---

## 6. 권장 시퀀스 (CISO sign-off 후 spec writer → jarvis launch)

> **상세는** `docs/security-soc2-risk-matrix.md` §3.

| Sprint | 기간 | PR | 목적 |
|---|---|---|---|
| **Sprint S1** (D+1~2주) | Type 1 기초 | PR-SEC17 (IR runbook), PR-SEC18 (access control policy + MFA 강제 evidence) | 정책 문서 |
| **Sprint S2** (D+2~4주) | Type 1 보강 | PR-SEC19 (change management policy + branch protection 강화), PR-SEC20 (vendor DPA register) | 거버넌스 |
| **Sprint S3** (D+4~6주) | 운영 통제 | PR-SEC21 (Sentry + 알림 → SEC-012 와 묶음), PR-SEC22 (backup restore drill 1회) | 탐지·복원 |
| **Sprint S4** (D+6~8주) | Type 1 신청 가능 | PR-SEC23 (risk assessment cadence), PR-SEC24 (Dependabot + dep-audit hard block → SEC-011 와 묶음), PR-SEC25 (onboarding/offboarding checklist) | mature |
| **Type 1 audit** | D+8주 ~ | 1~2주 KPMG / Deloitte 의 점검 | |
| **Type 2 운영 6mo+** | D+8주 ~ D+8개월 | control 운영 evidence 누적 (월 1회 access review, 분기 restore drill, 인시던트 처리 등) | |
| **Type 2 audit** | D+8개월~10개월 | audit firm 의 분기 evidence 샘플링 + 최종 보고서 | |

---

## 7. SEC1 (GDPR/OWASP) 과의 cross-reference

SEC1 의 28 발견은 SOC 2 와 다음과 같이 매핑:

| SEC1 발견 | SOC 2 영향 영역 | SOC 2 control |
|---|---|---|
| SEC-001 (open-redirect) → **fixed** PR #419 | CC6 logical access | CC6.6 — 외부 entity 와의 접근 제어 |
| SEC-002 (보안 헤더) → **fixed** PR #424 | CC6.7 | data transmission 보호 |
| SEC-003 (rate limit) → **fixed** PR #422 | CC6.8 | abuse 방지 |
| SEC-004/005 (Art. 17/15/20) → **fixed** PR #427/428 | P5 — user rights | privacy choice & consent |
| SEC-006/007 (동의) → **fixed** PR #421/426 | P2 — notice/communication | consent management |
| SEC-008 (ROPA/DPIA + audit_log) → **partial** PR #421 audit_log infra | CC2 / CC3 | risk + comm |
| SEC-009 (prompt injection) → **open** | CC6.7 / PI1.2 | input validation |
| SEC-010/016 (OAuth/tax 평문) → **open** | C1.1 | confidentiality |
| SEC-011 (dep-audit non-blocking) → **open** | CC7.1 / CC8.2 | system ops / change |
| SEC-012 (Sentry) → **open** | CC7.2 | monitoring |
| SEC-013 (admin audit) → **partial** PR #421 audit_log | CC2 / CC7.2 | logging |
| SEC-014 (국제 전송) → **open** | CC9.2 / C1.1 / P5 | vendor + privacy |
| SEC-015 (retention cron) → **fixed** PR #428 | P4 — data retention | privacy |
| SEC-017/018 (XSS/upload) → **open** | PI1.2 / CC6.7 | processing integrity / input |
| SEC-019 (login rate limit) → **fixed** PR #422 (포함) | CC6.6 | auth |
| SEC-020 (멤버 제거 세션) → **open** | CC6.5 | session mgmt |
| SEC-021 (voice retention) → **fixed** PR #428 | P4 | retention |
| SEC-022/025/027 (정책 v2) → **open** | P2 | notice |
| SEC-023 (CORS) → **open**, low | CC6.7 | network |
| SEC-024 (dev secret 분리) → **open** | CC6.2 / CC6.3 | provisioning |
| SEC-026 (incident response) → **open** ← **이 SOC 2 audit 의 SOC-001 과 동일** | CC7.4 | incident |
| SEC-028 (voice tool) → **open** | CC6.7 / PI1.2 | input |

**결론**: SEC1 P0 7건 fix 완료. SOC 2 의 추가 SOC-001~SOC-026 발견 26건 (별 매트릭스) 이 운영 통제 영역을 보완.

---

## 8. 범위 밖 (이번 SOC 2 audit 에서 다루지 않은 것)

- **실 SOC 2 audit 신청** (KPMG / Deloitte / EY / 삼정 / Vanta 등) — legal·biz 영역
- **ISO 27001 / HIPAA / PCI-DSS** — 별 audit
- **AWS / Vercel / Supabase 자체 SOC 2 evidence** — 처리자 측 책임 (vendor management 에서 attestation 만 확인)
- **물리 보안** — 클라우드 위탁
- **법인 거버넌스** (board structure, ethics) — 비기술 영역 (CISO+CEO 공동)
- **재해 보험 / cyber liability** — biz / legal
- **직원 background check / training** — HR 영역

---

## 9. 비개발자 설명

> SOC 2 는 enterprise 고객 (LG, 삼성, KB금융, 또는 EU 스타트업) 이 SaaS 도입 시 RFP 단계에서 "당신 회사 보안 어디까지 검증됐어?" 를 묻는 표준 인증. 통과 시 "외부 audit firm 이 6개월 운영 evidence 보고 OK 함" 을 증명 가능.
>
> 우리 상태: **기술 통제 (코드·DB 보호) 는 강함**. SEC1 audit 으로 P0 7건 fix 완료 — GDPR 권리 endpoint, 보안 헤더, rate limit, 동의, audit log, 데이터 export 모두 머지. SOC 2 가 추가 요구하는 **운영 절차 (인시던트 대응, 권한 review, 백업 drill, vendor 관리)** 가 거의 비어 있어, 4~6주 PR 시퀀스로 Type 1 (정책 + control design) 통과 가능, 추가 6개월 운영 evidence 누적 후 Type 2 (실 운영 효과) 신청 가능.
>
> 실 비용 추정: Type 1 \$30~50k + 내부 작업 4~6주, Type 2 \$60~100k + 내부 작업 6~12개월. **시점**: 2026 Q4 Type 1, 2027 Q2~Q3 Type 2.

---

## 10. 결론

기술 baseline 은 SEC1 의 4주 sprint 로 SOC 2 Common Criteria 의 control activities (CC5, CC6.6~6.8) 가 SaaS 평균을 상회. 남은 일은 **관리적 control + 탐지·대응 control + 운영 evidence**:

1. **정책 문서 7~8개** (security / IR / BCP / vendor / access / change / risk)
2. **권한 매트릭스 + MFA 강제 evidence** (외부 서비스 5+)
3. **Sentry + 알림 + audit_log 활용**
4. **Vendor DPA register + 연 review**
5. **분기 backup restore drill + RTO/RPO 정의**
6. **Branch protection 강화** (required reviewer ≥ 1, enforce_admins true, commit signing 선택)
7. **Dependabot + dep-audit hard block**
8. **Onboarding/offboarding checklist**

**Sprint S1~S4 (D+8주)** 머지 후 Type 1 신청 가능. 운영 시작 후 6mo+ evidence 누적 시점 (2027 Q1+) 에 Type 2 신청. **이 audit 의 read-only 결과는 CISO + (예정) Compliance Lead 가 review 후 fix sequence 승인 → spec writer 가 SOC-001~SOC-026 specs 작성 → jarvis launch** 의 흐름으로 진행.
