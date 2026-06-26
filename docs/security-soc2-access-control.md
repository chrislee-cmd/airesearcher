# SOC 2 — Access Control (CC6) 점검

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-soc2-audit-baseline-2026-06-26.md`
- **TSC**: Security (CC6.1~CC6.8), Confidentiality (C1.1), Privacy (P5)
- **범위**: 외부 시스템 (GitHub / Vercel / Supabase / OpenAI / Anthropic / 처리자 14+) 의 admin 접근 + 어플리케이션 레벨 user 접근 + service_role / API key 분배 + MFA / offboarding

---

## 0. 요약

**판정**: **Critical Gap**.

기술 control 은 강함 (110 route auth gate, 40+ 테이블 RLS, service_role 격리, 단일-세션 강제). **외부 시스템 admin 권한 매트릭스 / MFA 강제 / 정기 권한 review / offboarding 체크리스트** 가 모두 미문서. dev 머신에 평문 production service_role 다수 배포 (SEC-024) 가 잔여 critical 위험.

후속 PR: `SOC-002` (P0-S, 권한 매트릭스 + MFA 정책 문서), `SOC-009` (P1-S, dev secret 격리, SEC-024 재참조), `SOC-026` (P1-S, onboarding/offboarding checklist).

---

## 1. SOC 2 CC6 요구사항 매핑

| CC6.x | 요구사항 | 우리 상태 |
|---|---|---|
| **CC6.1** | 정보자산을 보호하는 logical access security software, infrastructure, architecture | ✅ RLS + service_role + signed URL + zod schema validation |
| **CC6.2** | 권한 등록·수정·삭제 절차 (provisioning) | ❌ 미문서 |
| **CC6.3** | 권한 분리 (least privilege + segregation of duties) | ⚠ DB 레벨 OK, 외부 admin 권한 review 없음 |
| **CC6.4** | 물리 접근 통제 | (클라우드 위탁 — Vercel/Supabase 의 SOC 2 attestation 의존) |
| **CC6.5** | logical / physical access 제거 (offboarding) | ❌ 절차 없음 |
| **CC6.6** | 외부 entity 와의 인증·접근 통제 | ✅ webhook HMAC, OAuth state, signed URL |
| **CC6.7** | 데이터 전송 보호 (TLS, encrypted-at-rest) | ✅ HTTPS / Supabase pgsodium / 보안 헤더 (PR-SEC3 머지) |
| **CC6.8** | 무단 / 악의적 software 차단 | ⚠ gitleaks + npm audit (non-blocking). EDR / 디바이스 MDM 없음 |

---

## 2. 어플리케이션 레벨 — 우리 사용자의 권한 (PASS)

### 2.1 사용자 분류

| Role | 정의 | 권한 |
|---|---|---|
| **anonymous** | 미로그인 | 정적 페이지 + `/api/public/scheduler/[slug]`, `/api/translate/public/[token]/*` (token 검증 RPC) |
| **member** (org member) | `organization_members.role = 'member'` | 자기 org 의 read + 정해진 write (transcript_jobs / desk_jobs / etc 본인 작업) |
| **admin** (org admin) | `organization_members.role = 'admin'` | 위 + 멤버 관리 / 결제 confirm / org 설정 |
| **owner** (org owner) | `organization_members.role = 'owner'` | 위 + org 삭제 / owner 양도 |
| **super-admin (platform)** | `profiles.role = 'admin'` 또는 hardcoded email list | `/admin/*` 페이지 + design-system gate + cron 수동 호출 |

### 2.2 RLS 강제 (PASS — SEC1 §3)

- 40+ 테이블 전수 `enable row level security`
- org-scoped: `has_org_role(org_id, 'viewer'|'member'|'admin'|'owner')` 함수로 멤버십 검증
- self-only: `auth.uid() = id` (profiles, user_google_oauth, user_notion_oauth)
- service-role-only: 정책 0 + RLS enable (trial_fingerprints, cache_entries, audit_log)

### 2.3 인증 강제 (PASS — SEC1 §2)

- 110 API route 전수 검사: 모두 auth gate 또는 의도된 무인증 (webhook HMAC / public token RPC / OAuth callback)
- 단일-세션 강제 (auth/callback `void signOut({ scope: 'others' })`) — PROJECT.md §7.12 준수
- Supabase JWT 의존 (4시간 만료 + refresh)

### 2.4 발견

이 영역은 PASS — 추가 SOC 2 발견 없음. SEC1 의 SEC-019 (login rate-limit) 는 PR #422 머지로 해소.

---

## 3. 외부 시스템 admin 권한 매트릭스 — **GAP**

**현재 상태**: 누가 어느 시스템의 admin/owner 인지 register 가 없음. 다음 표는 SOC 2 audit 시 작성 필수.

### 3.1 권한 매트릭스 (작성 필요 양식)

| 시스템 | role | 사용자 | MFA 강제 ? | 추가 통제 |
|---|---|---|:-:|---|
| **GitHub org `meteorresearch` / repo `airesearcher`** | Owner | chrislee-cmd | ? | required signed commits ? |
|  | Admin | (확인 필요) | ? | |
|  | Maintain | (확인 필요) | ? | |
|  | Write | (확인 필요) | ? | |
|  | Read | (확인 필요) | ? | |
| **Vercel team** | Owner | chrislee | ? | SAML SSO ? |
|  | Member | (확인 필요) | ? | |
|  | Developer | (확인 필요) | ? | |
| **Supabase org `meteorresearch`** | Owner | chrislee | ? | TOTP 강제 ? |
|  | Admin | (확인 필요) | ? | |
|  | Developer | (확인 필요) | ? | |
| **OpenAI Organization** | Owner | chrislee | ? | API key 분배 사용자 ? |
|  | Member | (확인 필요) | ? | |
| **Anthropic Workspace** | Owner | chrislee | ? | |
| **Deepgram** | Owner | (확인 필요) | ? | |
| **ElevenLabs** | Owner | (확인 필요) | ? | |
| **LiveKit Cloud** | Owner | (확인 필요) | ? | |
| **Twelvelabs** | Owner | (확인 필요) | ? | |
| **Stripe** | Account owner | (확인 필요) | ✅ Stripe 강제 | |
| **Lemon Squeezy** | Owner | (확인 필요) | ? | |
| **Google Cloud project** | Owner / Editor | (확인 필요) | ? | OAuth consent screen 관리자 ? |
| **Notion workspace** | Workspace owner | (확인 필요) | ? | |
| **Mixpanel project** | Owner | (확인 필요) | ? | EU residency 설정자 ? |
| **Upstash console** | Owner | (확인 필요) | ? | |
| **(예정) Sentry** | Owner | TBD | ? | |
| **(예정) Cloudflare** | Owner | TBD | ? | |
| **Domain registrar** (ai-researcher.com / mr.team) | Owner | (확인 필요) | ? | DNSSEC ? |
| **Email** (Gmail Workspace `meteor-research.com`) | Super-admin | (확인 필요) | ? | |

### 3.2 권장 권한 분배 패턴 (SOC 2 audit 통과 형)

- **Owner = 2명 이상** (사고 시 single-point-of-failure 방지). 단 startup 단계에선 1명 + 회복 계정 (e.g., `security@meteor-research.com` distribution list)
- **Admin / write 권한** = 명시적 직무 매핑. dev 는 read + 한정 write, 운영 관리는 admin
- **bot / CI 계정 분리**: Vercel CLI deploy bot, gitleaks, Dependabot 등은 별도 service account
- **MFA 강제**: 모든 owner / admin 필수. TOTP 또는 WebAuthn

### 3.3 SOC 2 발견

**🟡 SOC-002 — 외부 시스템 권한 매트릭스 + MFA 강제 evidence 미문서 (P0-S, HIGH)**
- 위 표 (§3.1) 가 빈 칸 — Type 1 audit firm 이 첫 질문할 부분
- 권장 조치:
  - GH/Vercel/Supabase/OpenAI/Anthropic 등 9~12개 시스템의 admin user list dump (screenshot 보관)
  - 각 시스템 settings 의 "require MFA" 옵션 활성 + 활성 screenshot 보관
  - `docs/security-access-matrix.md` 파일에 §3.1 표를 채워 commit
- 우선순위: P0-S (Type 1 통과 prerequisite)

**🟡 SOC-026 — onboarding / role-change / offboarding checklist 미작성 (P1-S, HIGH)**
- 직원 입사/이임 시 권한 부여/회수 절차 없음
- 권장 조치:
  - `docs/access-onboarding-checklist.md` — 입사 day-1 권한 부여 절차
  - `docs/access-offboarding-checklist.md` — 이임 권한 회수 + key rotation + 진행 작업 인계
  - role-change (e.g., dev → admin) 시 GH/Vercel/Supabase team membership 변경 절차
- 우선순위: P1-S

---

## 4. Service Account / API key 분배 — **GAP**

### 4.1 현재 secret 인벤토리

| Secret | 소유 시스템 | 분배 위치 | 회전 frequency |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Owner | Vercel env (production/preview/dev) + **로컬 .env.local (다수 worker 머신)** | 미정 |
| `OPENAI_API_KEY` | OpenAI Owner | 위 동일 | 미정 |
| `ANTHROPIC_API_KEY` | Anthropic Owner | 위 동일 | 미정 |
| `DEEPGRAM_API_KEY` | Deepgram Owner | 위 동일 | 미정 |
| `ELEVENLABS_API_KEY` | ElevenLabs | 위 동일 | 미정 |
| `LIVEKIT_API_KEY/SECRET` | LiveKit Cloud | 위 동일 | 미정 |
| `STRIPE_SECRET_KEY` | Stripe | 위 동일 | 미정 |
| `LEMONSQUEEZY_API_KEY` | Lemon Squeezy | 위 동일 | 미정 |
| `*_WEBHOOK_SECRET` (3종) | (각 vendor) | 위 동일 | 미정 |
| `GMAIL_APP_PASSWORD` | Google Workspace | 위 동일 | 미정 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud | 위 동일 | 미정 |
| `NOTION_CLIENT_SECRET` | Notion | 위 동일 | 미정 |
| `KAKAO_REST_API_KEY` | Kakao Developers | 위 동일 | 미정 |
| `NAVER_CLIENT_SECRET` | Naver Developers | 위 동일 | 미정 |
| `TWELVELABS_API_KEY` | Twelvelabs | 위 동일 | 미정 |
| `UPSTASH_REDIS_*` | Vercel marketplace integration | Vercel env | 자동 |
| `YOUTUBE_API_KEY`, `GEMINI_API_KEY` | Google Cloud | 위 동일 | 미정 |

### 4.2 발견

**🟡 SOC-009 — Dev 머신 secret 격리 (P1-S, HIGH — SEC-024 의 SOC 2 표면)**
- PROJECT.md §4 합류 절차의 `cp ../repo/.env.local .` 가 모든 worker 머신에 production 급 `SUPABASE_SERVICE_ROLE_KEY` (full DB access JWT) 평문 배포
- 5+ dev 머신이 동일 키 보유 → 1대 침해 시 production DB full access
- 권장 조치 (SEC1 의 PR-SEC17 와 동일 — 우선순위 격상):
  - 별도 Supabase project (`ai-researcher-dev`) + 별도 service_role
  - production key 는 Vercel-only (CI/CD 만)
  - `.env.local.example` 갱신 — 모든 env 문서 + dev 권한 명시
  - `PROJECT.md §4 합류 절차` 개정 — `vercel env pull` (dev project) 사용
- SOC 2 영향: **CC6.3 (least privilege) + CC6.5 (offboarding 시 key 회수) 모두 fail** — Type 1 evaluator 가 이 부분 발견 시 즉시 finding

**🟡 SOC-027 — API key rotation 정책 미정의 (P2-S, MEDIUM)**
- 어떤 키도 정기 회전 cadence 없음. 1년 이상 동일 키 사용 추정
- SOC 2 권장: 최소 1년 1회, vendor 의 권장 또는 침해 의심 시 즉시
- 권장 조치: `docs/security-key-rotation.md` — 키 별 회전 cadence + 절차 (Vercel env update + cascade 재배포)

---

## 5. Logical Access Provisioning (CC6.2)

### 5.1 onboarding (입사 day-1)

**현재**: 절차 없음. ad-hoc.

**권장 절차** (`docs/access-onboarding-checklist.md` 신규):
1. **사전 (manager)**: 역할 정의 → 권한 매트릭스에서 매핑 → tickets 발급
2. **Day 0**: Slack / Linear / 1Password 초대
3. **Day 1**:
   - GitHub org invite + 2FA 활성 확인
   - Vercel team invite + SAML SSO (있다면)
   - Supabase org invite + TOTP 활성 확인
   - (필요 시) OpenAI / Anthropic / Deepgram workspace invite
   - 회사 email 발급 + Gmail 2FA
   - VPN / 1Password vault access
   - PROJECT.md / CLAUDE.md / AGENTS.md 읽음 확인 (signed acknowledgement)
4. **Day 7**: 첫 PR 통과 + onboarding 평가
5. **manager sign-off**: `access-log/<userid>-onboarded-YYYYMMDD.md` 생성 + 권한 매트릭스 row 추가

### 5.2 role change

**현재**: 절차 없음.

**권장**: change ticket (Linear) → manager approval → access matrix 갱신 → 권한 추가/제거 → manager sign-off.

### 5.3 offboarding (이임)

**현재**: 절차 없음. (다행히 이임자 0명까지).

**권장 절차** (`docs/access-offboarding-checklist.md` 신규):
1. **사전 (manager)**: 진행 중 작업 인계 + 완료 spec
2. **마지막 근무일**:
   - GitHub org / repo 권한 제거 (Owner 가 수행)
   - Vercel team 제거
   - Supabase org 제거
   - OpenAI / Anthropic / Deepgram workspace 제거
   - Slack / Linear / 1Password / VPN 제거
   - 회사 email 자동 응답 설정 + 30일 후 삭제
   - 만약 owner / single-user-known secret 보유: **모든 관련 키 회전** (`SUPABASE_SERVICE_ROLE_KEY` 등)
3. **동일 day +1**:
   - audit_log 에 access removal 이벤트 기록
   - manager sign-off: `access-log/<userid>-offboarded-YYYYMMDD.md`
4. **+30일 후**:
   - email 삭제
   - 잔여 권한 audit (예: forgotten Drive 공유 권한)

### 5.4 정기 access review

**현재**: 0회.

**권장 cadence**:
- **분기 1회** (3월 / 6월 / 9월 / 12월 말):
  - 각 시스템의 user list dump
  - 권한 매트릭스 (§3.1) 와 비교
  - 의심 user / 사용 안 하는 권한 → 회수 결정
  - 결과: `access-review/YYYY-QN.md` — 검토자 / 발견 / 조치
- **연 1회** (12월):
  - 전체 권한 정책 review + 매트릭스 v2

### 5.5 발견

**🟡 SOC-026 — onboarding/offboarding/review checklist 0 (P1-S, HIGH)**
- 위 §5.1~5.4 절차 모두 미문서
- Type 1 audit 시 evaluator 가 "어떻게 권한 부여하고 회수하는가" 질문 → 즉답 불가
- 권장 조치: 위 3개 markdown 파일 작성 + `access-review/` 디렉토리 셋업

---

## 6. MFA 강제 — **확인 + 강제 필요**

### 6.1 각 시스템의 MFA 옵션

| 시스템 | MFA 옵션 | "require" 강제 옵션 | 현재 상태 |
|---|---|---|---|
| GitHub | TOTP / WebAuthn / SMS | Org settings → "Require two-factor authentication" | **확인 필요** |
| Vercel | TOTP / SAML SSO / Passkey | Team settings → "Require" | **확인 필요** |
| Supabase | TOTP / WebAuthn | Org settings → "Require MFA" | **확인 필요** |
| OpenAI | TOTP | API platform settings | **확인 필요** |
| Anthropic | TOTP / SAML | Workspace settings | **확인 필요** |
| Google Workspace | TOTP / WebAuthn / 보안 키 | Admin console → "2-step verification" | **확인 필요** |
| Stripe | 강제 | (default) | ✅ Stripe 강제 |
| 기타 vendor | (각 service dependent) | 확인 필요 | **확인 필요** |

### 6.2 발견

**🟡 SOC-002 안에 포함 (P0-S)** — 각 시스템 admin / member 의 MFA 활성 + screenshot evidence 보관.

권장 조치:
- GH org → "Require two-factor authentication" 활성
- Vercel team → 동일
- Supabase org → 동일
- 각 LLM vendor admin account → 동일
- evidence: `access-evidence/YYYYMMDD/<system>-mfa.png` 디렉토리

---

## 7. Confidentiality (C1) 보강

### 7.1 데이터 분류

SOC 2 의 **C1.1** 은 비공개 데이터의 식별·보호. 현재 우리 분류 (SEC1 data-flow.md 의 PII 분류 기반):

| 분류 | 정의 | 보호 정책 |
|---|---|---|
| **PUBLIC** | 마케팅 / blog / docs | restriction 없음 |
| **INTERNAL** | PROJECT.md / 디자인 시스템 / 코드 | GitHub repo (private) + RLS auth-gate |
| **CONFIDENTIAL** | user PII + interview transcript + voice / video | RLS + signed URL + at-rest 암호화 (Supabase 기본) |
| **RESTRICTED** | OAuth token / API key / service_role / payment data | Vercel env-only + DB 의 sensitive 컬럼은 **암호화 권장** (SEC-010/016 미해소) |

### 7.2 발견

- ✅ **PUBLIC / INTERNAL / CONFIDENTIAL**: RLS / private repo / TLS 모두 covered
- ❌ **RESTRICTED**: OAuth refresh_token + tax_invoice JSONB 평문 (SEC-010 / SEC-016) → SEC1 PR-SEC13 미머지

권장 조치: SEC1 PR-SEC13 (pgsodium / pgcrypto) launch 우선순위 → SOC 2 와 같이 묶어 처리.

---

## 8. 검증 시나리오 (Type 1 audit 시 evaluator 가 할 질문 prep)

| 질문 | 우리 답 (현재) | 보강 후 답 |
|---|---|---|
| "GitHub repo admin 누구?" | (구두) | `access-matrix.md` row 표시 + GitHub screenshot |
| "MFA 강제 어떻게 ?" | 구두 | screenshot + org settings |
| "직원 떠나면 ?" | 구두 ad-hoc | `access-offboarding-checklist.md` + 실 사례 evidence |
| "service_role 누가 보유 ?" | (구두) | secret inventory + Vercel-only 입증 + dev 분리 evidence |
| "분기별 권한 review 했는가 ?" | 0회 | `access-review/2026-Q3.md` 등 |
| "OAuth token 보호 ?" | RLS only | pgsodium 적용 (PR-SEC13) + at-rest 암호화 evidence |
| "API key 회전 ?" | 미회전 | `key-rotation-policy.md` + Vercel env history |
| "shared password ?" | (실은 1Password 추정 — 확인 필요) | 1Password vault + access matrix |

---

## 9. 후속 조치 요약

| ID | 우선순위 | 작업 | size |
|---|:-:|---|---|
| `SOC-002` | **P0-S** | 외부 시스템 권한 매트릭스 + MFA 강제 활성 + evidence screenshot | M |
| `SOC-026` | P1-S | onboarding/offboarding/role-change checklist 3개 markdown | M |
| `SOC-009` | P1-S | dev 머신 secret 격리 (SEC-024 와 동일 — 격상) | L |
| `SOC-027` | P2-S | API key rotation 정책 + 매년 1회 cadence | S |

> **이행 후** `docs/security-access-matrix.md` + `docs/access-onboarding-checklist.md` + `docs/access-offboarding-checklist.md` + `docs/security-key-rotation.md` 4 markdown 추가 + `access-review/` 디렉토리 분기마다 갱신.

---

## 10. 결론

어플리케이션 레벨 access control 은 SOC 2 CC6.6~CC6.7 (외부 entity / 데이터 전송) 까지 PASS. **외부 시스템 admin 권한 매트릭스 / MFA 강제 / provisioning checklist / 정기 review** 가 모두 빈 칸 — CC6.1~CC6.5 가 fail likely. 4 markdown + 1 디렉토리 추가 + 외부 시스템 settings 활성 작업으로 Type 1 통과 가능 (2~3주 추정).
