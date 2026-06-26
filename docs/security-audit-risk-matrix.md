# 보안 audit — 위험 매트릭스 (Phase 0)

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-audit-baseline-2026-06-26.md`
- **총 발견**: 28건 (Critical 7 · High 9 · Medium 8 · Low 4)
- **사용**: 후속 PR (`docs/security-audit-followups.md`) 작성 input + CISO 검토 trace

---

## 등급 정의

| 등급 | 정의 |
|---|---|
| **Critical (P0)** | 데이터 누출 / 계정 탈취 / 서비스 중단 / 법적 노출이 즉시 가능. CISO reject 사유. 머지 차단 권장 |
| **High (P1)** | 운영 시작 전 fix 필수. 단독으로는 catastrophic 아니나 결합 시 또는 abuse 시 큰 영향 |
| **Medium (P2)** | post-launch 1~3개월. defense-in-depth / 컴플라이언스 보강 |
| **Low (P3)** | 인지·계획만. 즉각 fix 불필요 |

---

## 매트릭스

| ID | 영역 | 발견 | 위험 | 영향 | likelihood | 권장 조치 | 우선 | 파일·라인 |
|---|---|---|:-:|---|:-:|---|:-:|---|
| **SEC-001** | Auth | `/auth/callback?next=//attacker.com` open-redirect — `new URL(target, origin)` 가 protocol-relative URL 을 외부 도메인으로 해석 | Critical | 계정 탈취 / 피싱 / OAuth code 가로채기 | high | `target` 검증: `startsWith('/') && !startsWith('//')` 만 허용 | **P0** | `src/app/auth/callback/route.ts:8, 40-41` |
| **SEC-002** | Network | `next.config.ts` 에 `headers()` 정의 없음 — HSTS / CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy 0개 | Critical | XSS 차단 최후 방어선 부재, clickjacking, MIME confusion, HTTPS downgrade | high | `next.config.ts` 에 `async headers()` 추가. CSP 는 nonce-based 로 단계적 도입 | **P0** | `next.config.ts` 전체 |
| **SEC-003** | Network | 어플리케이션 레벨 rate limit 부재 — `rate.limit/limiter/upstash` grep 0건. 유일 quota: `VOICE_DAILY_LIMIT_SEC` | Critical | LLM bill-bomb / credential stuffing / 가입 spam / token enum | high | Upstash Redis token bucket per IP + per user. LLM endpoint 부터. Vercel Firewall WAF rule 도 활성 | **P0** | (없음 — 신규 미들웨어) |
| **SEC-004** | GDPR | Art. 17 탈퇴 흐름 미구현 — `delete account` grep 0 hit. 개인정보처리방침 §3 약속한 "지체 없이 파기" 미이행 | Critical | EU 사용자 권리 침해 / 법적 노출 / CISO reject | high | `/api/account/delete` endpoint + 설정 UI + cascade audit | **P0** | (없음 — 신규) |
| **SEC-005** | GDPR | Art. 15 / 20 자가 export 미구현 — 이메일 신청만 약속 | Critical | EU 사용자 권리 침해 / 30일 응답 deadline 미달성 | high | `/api/account/export` (모든 PII JSON dump) | **P0** | (없음 — 신규) |
| **SEC-006** | GDPR | Art. 7 명시적 동의 미수집 — 가입 폼에 ToS / Privacy 체크박스 없음, `terms_accepted_at` 컬럼 없음, 쿠키 배너 없음 | Critical | EU launch blocker | high | 가입 폼 checkbox + 동의 audit table + 쿠키 banner | **P0** | `src/components/email-password-form.tsx` |
| **SEC-007** | GDPR | Mixpanel 동의 없이 `init` — `persistence: 'localStorage'`, distinct_id = email | Critical | ePrivacy + GDPR Art. 7 위반 | high | consent state 체크 후 init / 거부 시 noop. EU residency 옵션 활성 또는 대체 (Plausible/Fathom) | **P0** | `src/components/mixpanel-provider.tsx:113-120` |
| **SEC-008** | GDPR | Art. 30 ROPA / Art. 35 DPIA / audit_log 테이블 부재 — 책임성 (accountability) 미충족 | High | 검수 시 문서 제출 불가 / 침해 시 forensics 불가 | high | ROPA doc (`docs/gdpr-ropa.md`) + DPIA doc (`docs/gdpr-dpia-llm.md`) + `audit_log` 테이블 + admin/auth 이벤트 logging | **P1** | (없음 — 신규) |
| **SEC-009** | Input | Prompt injection 표면 4개 route — XML wrapping / escape 없이 사용자 입력 → system prompt concat | High | 모델 hijack / 잘못된 출력 / 비용 abuse | medium | `<user_input>...</user_input>` 래핑 + 시스템 프롬프트에 "literal text" 명시 + 출력 schema 검증 (zod) | **P1** | `src/app/api/interviews/extract/route.ts:56`, `interviews/chat/route.ts:170`, `desk/route.ts:637-643`, `probing/suggest/route.ts:54-71` |
| **SEC-010** | Crypto | OAuth refresh / access token 평문 저장 — `user_google_oauth.refresh_token`, `user_notion_oauth.access_token` | High | DB dump / replica leak 시 사용자 Google/Notion 계정 탈취 | low (RLS + service-role insert) | `pgcrypto` 또는 `pgsodium` 으로 컬럼 암호화 + key 관리 | **P1** | `supabase/migrations/0012_google_oauth_tokens.sql`, `0019_share_notion_oauth.sql` |
| **SEC-011** | Deps | pnpm audit: 12 high + 20 moderate CVE. CI `pnpm audit` `continue-on-error: true` (비차단). `next@16.2.4` → patched `>=16.2.5` | High | 알려진 CVE 미패치 production 도달 | high | Dependabot enable + CI `--audit-level=high` hard fail flip + branch protection 에 `Dependency audit` 추가. 즉시 `next@16.2.5` upgrade | **P1** | `package.json`, `.github/workflows/ci.yml:103` |
| **SEC-012** | Logging | 에러 트래킹 0개 — `Sentry/PostHog/Datadog` grep 0 hit. Production 사고 invisible | High | 사고 인지 지연 / forensics 불가 / user impact 추적 불가 | high | Sentry 도입 (PII scrub + source map upload) | **P1** | (없음 — 신규) |
| **SEC-013** | Logging | 관리자 행위 audit log 부재 — `/api/admin/*`, `/api/members/*`, `/api/billing/admin/*` 변경 시 별도 테이블 기록 없음 | High | 권한 남용 탐지 불가 / GDPR Art. 30 / 32(d) 위반 | medium | `audit_log(event, actor_id, target_id, before, after, ts)` 테이블 + admin route wrapper | **P1** | (없음 — 신규) |
| **SEC-014** | GDPR | 국제 전송 거버넌스 미증명 — Supabase region 코드 pin 없음 / OpenAI zero-retention 미사용 / Mixpanel EU residency 미설정 / 처리자 DPA 서명 evidence 없음 | High | EU launch 시 DPA 권한기관 (CNIL / ICO 등) 의 audit request 응답 불가 | medium | (a) Supabase region 확인 + 명시, (b) OpenAI ZDR 또는 enterprise, (c) Mixpanel EU residency 또는 대체, (d) DPA 서명본 driverpdf 보관 + `docs/gdpr-subprocessors.md` 공개 | **P1** | (없음 — config + 문서) |
| **SEC-015** | GDPR / Storage | 자동 retention cron 부재 — translate cleanup 만 존재. `trial_fingerprints` (IP 평문), `voice_sessions/messages`, `insights_jobs/quotes`, expired `translate_messages` 영구 보존 | High | Art. 5(1)(e) storage limitation 위반 | high | `/api/cron/retention/{trial,voice,insights,translate}` + `vercel.json` cron 추가. 정책 (예: 90일 / 30일 / 90일) 사용자 통지 | **P1** | (없음 — 신규 cron) |
| **SEC-016** | Crypto | `payments.tax_invoice` JSONB 평문 — 한국 사업자번호 / 대표자명 / 주소 | High | DB leak 시 한국 PIPA + GDPR 동시 영향 | low | sensitive sub-key 만 pgcrypto. 또는 별도 테이블 + 강화 RLS | **P1** | `supabase/migrations/0010_payments.sql` |
| **SEC-017** | XSS | `mammoth.convertToHtml()` → `dangerouslySetInnerHTML` — DOCX 안에 `<script>` payload 가능. 현재 iframe sandbox 로 차단 but 패턴 재사용 위험 | Medium | XSS / 세션 탈취 (재사용 시 critical) | low | `isomorphic-dompurify` 로 sanitize 또는 iframe sandbox 강화 (`allow-same-origin` 제거) | **P2** | `src/components/canvas/widgets/quotes-card-body.tsx:~807`, `src/app/api/transcripts/jobs/[id]/preview/route.ts:101` |
| **SEC-018** | Input | 파일 업로드 MIME / magic-byte 검증 없음 — `/api/transcripts/upload-url`, `/api/video/upload-url`, `/api/insights/files` | Medium | 악의적 파일 → pandoc/libreoffice CVE → RCE 표면 | medium | `file-type` 패키지로 magic byte 검사 + MIME 화이트리스트 + 크기 hard limit | **P2** | `src/app/api/transcripts/upload-url/route.ts`, `video/upload-url/route.ts`, `insights/files/route.ts` |
| **SEC-019** | Auth | 로그인 실패 rate-limit 부재 — Supabase 기본 throttle 외 어플리케이션 차단 없음 | High | 1만 user 환경에서 credential stuffing 표면 | medium | SEC-003 의 rate limiter 가 `/api/auth/*` 도 포함 / Cloudflare Turnstile or hCaptcha | **P1** | (없음) |
| **SEC-020** | Auth | 멤버 제거 시 명시적 세션 revocation 없음 — RLS 가 implicit 차단하나 realtime channel 30초 지연 | Medium | 제거된 멤버가 30초 동안 realtime 데이터 수신 가능 | low | `/api/members/remove` 에서 `auth.admin.signOut(targetUserId)` 호출 | **P2** | `src/app/api/members/remove/route.ts:20-23` |
| **SEC-021** | Storage | `voice_messages` 무기한 보존 — retention 정책 없음 | Medium | 음성 transcript 평생 보존 → GDPR 5원칙 위반 | medium | SEC-015 cron 에 포함 (90일 권장) + 사용자 통지 | **P2** | `supabase/migrations/0023_voice_concierge.sql` |
| **SEC-022** | GDPR | 개인정보처리방침 격차 — legal basis per activity 미기재, supervisory authority 연락처 (KR PIPC / EU DPA) 없음, 처리자 US 위치 명시 부족, Art. 14 (respondent) 별도 통지 없음 | Medium | DPA 요구 자료 부족 / 사용자 정보권 (Art. 13) 부분 충족 | medium | 정책 v2 작성 — `src/app/[locale]/privacy/page.tsx` 갱신 (시행일자 변경 + 변경 안내) | **P2** | `src/app/[locale]/privacy/page.tsx` |
| **SEC-023** | Network | 명시적 CORS 정책 없음 — Vercel default same-origin 의존 | Low | 향후 외부 통합 / 모바일 앱 시 ad-hoc 설정 위험 | low | API route 의 `OPTIONS` handler 표준화 + 허용 origin 화이트리스트 | **P3** | (없음) |
| **SEC-024** | Secret | 모든 worker 머신에 production 급 `SUPABASE_SERVICE_ROLE_KEY` + OpenAI/Anthropic 키 평문 존재 — PROJECT.md §4 `cp .env.local` 절차 | Medium | dev 머신 1 침해 = production DB full access. 회전 시 모든 머신 동기화 필요 | low | dev 전용 Supabase project 분리 (별도 service_role). production key 는 Vercel-only. Secret manager (1Password CLI / Doppler / Vercel CLI) 도입 | **P2** | `PROJECT.md §4` + `.env.local` distribution |
| **SEC-025** | GDPR | ToS / Privacy 동의 체크박스 없음 — SEC-006 의 인접 — `terms_accepted_at` 컬럼 / 버전 트래킹 없음 | Low (SEC-006 의 일부) | 버전 변경 시 누가 어느 버전 동의했는지 audit 불가 | medium | SEC-006 작업에 포함 — `terms_versions` + `user_consent(user_id, version, accepted_at)` | **P3** | (SEC-006 와 묶음) |
| **SEC-026** | Process | 침해 통지 (Art. 33/34) 절차 문서 없음 | Low | 침해 시 72시간 통지 의무 미준수 위험 | low | `docs/security-incident-response.md` 작성 — 책임자 / 통지 경로 / template | **P3** | (없음) |
| **SEC-027** | GDPR / Tracking | 쿠키 동의 banner 없음 — Mixpanel = non-essential cookie, ePrivacy 적용 | Low (SEC-007 의 일부) | ePrivacy 위반 (EU 한정) | medium | SEC-007 작업과 묶음 — banner UI + consent state provider | **P3** | (SEC-007 와 묶음) |
| **SEC-028** | LLM | voice tool 호출 (`/api/voice/tools/get-credits`, `get-projects`) 인자 검증 미확인 — depth 검토 필요 | Low | tool arg injection 시 SQL/path/외부 호출 위험 | low | 두 route 의 zod 검증 + RLS 의존도 확인 | **P3** | `src/app/api/voice/tools/get-credits/route.ts`, `get-projects/route.ts` |

---

## 영역별 발견 분포

| 영역 | Critical | High | Medium | Low |
|---|:-:|:-:|:-:|:-:|
| Auth & Session | 1 | 1 | 1 | 0 |
| AuthZ (RLS / IDOR) | 0 | 0 | 0 | 0 |
| Input Validation | 0 | 1 | 2 | 0 |
| Secret Management | 0 | 1 | 1 | 0 |
| GDPR / Data Protection | 4 | 4 | 2 | 2 |
| Network & Infra | 2 | 0 | 0 | 1 |
| Logging & Monitoring | 0 | 2 | 0 | 0 |
| Dependencies | 0 | 1 | 0 | 0 |
| LLM 특수 | 0 | 0 | 0 | 1 |
| Process | 0 | 0 | 0 | 1 |
| **합계** | **7** | **9** | **8** | **4** |

---

## OWASP Top 10 (2021) 매핑

| OWASP | 발견 ID | 합계 |
|---|---|---|
| **A01 Broken Access Control** | SEC-001, SEC-020 | 2 |
| **A02 Cryptographic Failures** | SEC-002 (HSTS), SEC-010, SEC-016, SEC-024 | 4 |
| **A03 Injection** | SEC-009 (prompt), SEC-017 (XSS), SEC-018 (SSRF via 업로드) | 3 |
| **A04 Insecure Design** | SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-013, SEC-015 | 8 |
| **A05 Security Misconfiguration** | SEC-002 (헤더), SEC-011 (audit non-blocking), SEC-014 | 3 |
| **A06 Vulnerable Components** | SEC-011 | 1 |
| **A07 Identification & Auth Failures** | SEC-019, SEC-020 (인접) | 1 |
| **A08 Software & Data Integrity** | (no specific finding — lockfile / CI signing OK) | 0 |
| **A09 Logging & Monitoring Failures** | SEC-012, SEC-013 | 2 |
| **A10 SSRF** | SEC-018 | 1 |

---

## GDPR Article 매핑

| GDPR | 발견 ID |
|---|---|
| Art. 5 (원칙) | SEC-015 (storage limitation), SEC-016 (integrity) |
| Art. 6 (legal basis) | SEC-006, SEC-022 |
| Art. 7 (동의 조건) | SEC-006, SEC-007, SEC-027 |
| Art. 13 / 14 (정보 제공) | SEC-022 |
| Art. 15 (열람권) | SEC-005 |
| Art. 17 (삭제권) | SEC-004 |
| Art. 18 (제한) | SEC-004 (인접) |
| Art. 20 (이동권) | SEC-005 |
| Art. 21 (처리거부) | SEC-007 |
| Art. 25 (by design) | SEC-010, SEC-016 |
| Art. 28 (processor) | SEC-014 |
| Art. 30 (ROPA) | SEC-008, SEC-013 |
| Art. 32 (보안) | SEC-002, SEC-003, SEC-010, SEC-012, SEC-013 |
| Art. 33 / 34 (침해 통지) | SEC-026 |
| Art. 35 (DPIA) | SEC-008 |
| Art. 44–49 (국제 전송) | SEC-014 |

---

## 사용 가이드

1. **CISO 검수 시**: 등급 + 위치 (파일·라인) + 권장 조치 3컬럼만 보여줘도 충분
2. **후속 PR spec 작성 시**: ID + 우선순위 + 영역으로 묶어 PR 분할 → `docs/security-audit-followups.md` 참고
3. **사후 audit (3개월 후)**: 동일 ID 로 status 갱신. resolved 는 strikethrough 또는 별도 RESOLVED 컬럼 추가
