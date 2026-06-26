# SOC 2 — Incident Response (CC7.4) runbook 초안 + 템플릿

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-soc2-audit-baseline-2026-06-26.md`
- **TSC**: Security (CC7.4), Availability (A1.3), Privacy (P6)
- **범위**: 보안 인시던트 정의 / 분류 / 응답 절차 / 통보 SLA / post-mortem / runbook (자주 발생 시나리오)

---

## 0. 요약

**판정**: **Critical Gap (현재)** → 이 문서 v1 작성 + 1회 tabletop drill 시 **Pass**.

현재 우리 상태: runbook·SLA·post-mortem 템플릿·on-call rotation **모두 0**. SOC 2 Type 1 의 인시던트 대응 control 은 "정책 + 절차 + 책임자 매트릭스" 의 design 만 검증 → 이 문서 + 실 1회 drill 만 있어도 통과 가능. Type 2 는 6mo+ 의 incident handling evidence 누적 필요.

이 문서가 그대로 `docs/runbook-incident-response.md` 로 승격 가능한 형식 — CISO sign-off + 1회 tabletop drill 후 v1.0 확정.

---

## 1. 인시던트 정의

**보안 인시던트** = 다음 중 하나가 발생했거나 발생 의심:
- 무단 접근 또는 권한 우회 (예: 다른 org 의 데이터 조회)
- 데이터 누출 (예: DB dump 외부 노출, OAuth token 탈취)
- 서비스 중단 (예: Vercel/Supabase outage, DB lock, LLM provider 장애)
- abuse / 비용 폭주 (예: 단일 user 의 LLM API 비용 spike, rate limit 우회)
- 악성 코드 / supply chain (예: npm 패키지 침해, CI runner 침해)
- 사고로 인한 데이터 손실 (예: migration 실수로 인한 row 손실)
- 외부 공격 (예: DDoS, credential stuffing, SQL injection 시도)
- 개인정보 침해 (GDPR Art. 33 — 무단 접근/변경/공개/손실/소실)

**비-인시던트** (incident 가 아닌 사례):
- 정상 운영 (e.g., 사용자 비밀번호 reset)
- 평시 모니터링 (e.g., 정상 트래픽 증가)
- 비기능 issue (UI 글자 오타) — bug ticket 으로 처리

---

## 2. 인시던트 분류 (severity matrix)

| 등급 | 정의 | 응답 SLA | 예시 |
|---|---|---|---|
| **P0 / Critical** | 데이터 누출 / 서비스 완전 중단 / 권한 우회 / GDPR 침해 통지 trigger | 즉시 인지·containment 1시간 안에. 통지 SLA 적용 | DB dump 누출, 권한 우회 발견, Supabase outage 전체, OAuth token leak, payment fraud |
| **P1 / High** | 일부 기능 중단 / single-user 데이터 손실 / 의심 침해 활동 / abuse 비용 spike | 응답 4시간, 해결 24시간 | LLM endpoint 비용 spike (>10x), 다중 로그인 실패 동일 IP, transcription provider 장애 |
| **P2 / Medium** | 단일 사용자 영향 / 정상 백업 절차 가능 / 운영 abnormality | 응답 1 영업일, 해결 3 영업일 | 1 user transcript 처리 실패, OAuth provider 일시 장애, Mixpanel event delay |
| **P3 / Low** | 운영 보안 관련 발견, fix 필요하나 즉각 위협 X | 응답 5 영업일, 해결 30일 | 의심 IP 의 cron-style probe, dep CVE high 발견 (immediate exploit X), audit_log 알림 false-positive |

---

## 3. 응답 절차 (P0~P3 공통, 단계별 SLA 차등)

```
[Detect] → [Triage] → [Contain] → [Eradicate] → [Recover] → [Post-mortem]
   1         2          3            4             5            6
```

### 3.1 단계 1 — Detect (인지)

**탐지 경로** (현재 + 보강):
- 현재: 사용자 신고 (Slack / 메일), 본인 직접 발견, vendor status page
- 보강 (SOC-003 후 활성):
  - Sentry alert → Slack `#alerts` (error rate spike, new error type)
  - Vercel Functions log → Slack (function timeout / 5xx rate)
  - audit_log 알림 → Slack (admin-level 행위 / 비정상 로그인 패턴)
  - rate limit hit 임계 → Slack (단일 IP 100/min hit)
  - LLM 비용 dashboard → 일별 anomaly 알림
  - vendor status page integration (statuspage RSS → Slack)

**Detect 시점에 즉시 기록할 정보**:
- 시각 (UTC, second precision)
- 탐지 경로
- 초기 영향 추정 (사용자 수, 영향 도메인)
- 보고자 (사람 이름 또는 자동 system)

### 3.2 단계 2 — Triage (분류 + 권한)

**누가 triage 하는가**:
- **권한 부여** (incident commander, IC): 현재 = chrislee 단독. 보강 = backup operator (PR-SOC-016)
- IC 가 부재 시 → on-call rotation 또는 backup 으로 30분 안에 escalation

**triage 결정사항** (15~30분 안에):
- severity 분류 (§2 의 P0~P3)
- impact 추정 (사용자 수 / 영향 도메인 / 데이터 카테고리)
- 통지 SLA 적용 여부 (예: P0 GDPR 침해 → 72h)
- escalation 필요? (CISO sign-off / 외부 DPA 자문 / vendor 측 escalation)

**triage 후 communication 시작**:
- `#incident-<incident_id>` Slack 채널 생성 (P0/P1)
- status page 업데이트 (외부 사용자 영향 시 — 미도입)
- 내부 stakeholder 통지 (founder / 영업 / 디자인)

### 3.3 단계 3 — Contain (확산 차단)

**목적**: 인시던트의 추가 확산 / 추가 손실 방지. 근본 fix 가 아님.

**일반 containment 액션**:
- 침해 의심 계정 비밀번호 강제 reset + `auth.admin.signOut`
- 침해 의심 service_role / API key 즉시 회전
- 의심 IP / IP/24 차단 (Vercel Firewall WAF rule)
- 의심 endpoint 비활성 (deploy with feature flag off — 또는 임시 405 응답)
- vendor 측 emergency throttle (OpenAI / Anthropic 의 API 호출 임시 stop)
- DB 변경 freeze (모든 마이그 / DDL pause)

**containment 의 trade-off**:
- 사용자 영향 증가 (false-positive 시 정상 사용자 차단)
- 추적 evidence 손실 (예: attacker IP block 시 그 IP 추가 활동 못 봄)
- IC 의 판단 — speed vs preservation

### 3.4 단계 4 — Eradicate (제거)

**근본 원인 fix**:
- 코드 변경 → emergency change 절차 (`hotfix:` prefix PR)
- DB 변경 → reverse migration (SOC-013)
- 키 회전 → 모든 분배처 동시 갱신
- 침해 계정 → 무력화 + 모든 session revoke
- 누출 데이터 → vendor 측 deletion 요청 (e.g., OpenAI 측 prompt history 삭제)

### 3.5 단계 5 — Recover (정상 복원)

- 영향 받은 사용자에게 데이터 / 기능 복원
- backup restore 필요 시 → BCP runbook 의 §6 참조
- monitoring 재활성 + 의심 패턴 false-alarm 차단
- containment 액션 점진 해제 (예: WAF rule 강도 점진 완화)

### 3.6 단계 6 — Post-mortem (사후 분석)

**의무** (SOC 2 CC7.4):
- P0 / P1 → post-mortem 문서 작성 (incident 해소 후 5 영업일 안)
- P2 / P3 → 선택 (필요 시)

**문서 위치**: `docs/incidents/YYYY-MM-DD-<short-id>.md` (template § 6)

**필수 내용**:
- 시각표 (detect → triage → contain → eradicate → recover)
- 근본 원인 (root cause)
- 발견·격리·해결까지 시간
- 영향 받은 사용자 / 데이터
- 통지 (사용자 / 규제 / vendor) 결과
- prevention actions (재발 방지)
- monitoring 보강 (이번 incident 가 더 빨리 잡힐 수 있게)

---

## 4. 통지 SLA 매트릭스

| 대상 | 사유 | SLA | 책임자 |
|---|---|---|---|
| **사용자 (영향 받은)** | 데이터 누출, 서비스 중단 (>1h), GDPR 침해 (Art. 34) | "지체 없이" — 권장 24h 안에 | CISO + 영업 (직접 통지 메일) |
| **사용자 (전체)** | 전체 서비스 영향 / status update | status page (도입 후) — incident 시작 시 | IC |
| **GDPR supervisory authority** | personal data breach (Art. 33) | **72h** | CISO + DPO (외부 자문) |
| **한국 PIPC / KISA** | 한국 PIPA breach 통지 | "지체 없이" (현행법 24h 가이드라인) | CISO |
| **결제 vendor (Stripe / Lemon Squeezy)** | 결제 침해 의심 | 24h | CISO |
| **DPA-체결 vendor** | 처리자 측 침해 시 우리에게 통지 받음 (역방향) | DPA 명시 — 일반 72h | CISO |
| **내부 stakeholder (founder / 영업)** | P0 / P1 | 1h | IC |
| **board / 투자자** | 중대 침해 (>10% user 영향, >$10k 손실) | 24h | CEO (chrislee) |
| **보험사** (cyber liability — 미가입) | 손실 / 법적 노출 | 사고 인지 24h | CISO |

### 4.1 GDPR Art. 33 통지 의무 (EU 사용자 침해 시)

**72시간 안에** EU supervisory authority (지정된 lead authority — 우리 경우 한국 사용자가 다수면 KR PIPC, EU 비중 큰 후 CNIL 또는 ICO) 에 통지:
- 침해 성격 + 영향 데이터 카테고리 + 추정 사용자 수
- DPO 또는 단일 contact point 연락처
- 우리가 취한 / 취할 조치
- 사용자에 대한 likely 영향

**Art. 34**: "high risk" 침해는 사용자에게도 직접 통지 의무. 예외: (a) 적절한 보호 (encryption) 가 있어 무용 (b) 사후 조치로 risk 해소 (c) 과도한 노력 — public communication 으로 대체.

### 4.2 한국 PIPA 통지 의무

- 1,000명 이상 영향 → 인지 후 72h 안에 KISA 신고 + 사용자 통지
- 1,000명 미만 → 인지 후 가능한 빨리 사용자 통지 (KISA 미 통지)

---

## 5. Runbook — 자주 발생 시나리오

### 5.1 Runbook A — Supabase outage (P0)

**탐지**: status.supabase.com / 5xx rate spike / connection failure
**Triage**: vendor 확인 (Supabase status), 영향 도메인 확인 (전체 vs 일부 region)
**Contain**:
- 정상 / status page 메시지 ("Supabase 측 장애, 복원 대기")
- 사용자 영향 큰 endpoint (login, transcripts/start) → 임시 503 응답 + 안내
- 신규 가입 / 결제 일시 차단
**Eradicate**: vendor 측 복원 대기 (우리 측 할 수 있는 fix 없음)
**Recover**: monitoring 으로 복원 확인 후 service 재개
**Post-mortem**: vendor RCA + 우리 측 dependency 평가

### 5.2 Runbook B — LLM 비용 spike (P1)

**탐지**: 일별 비용 monitoring (도입 후) / OpenAI/Anthropic dashboard 알림
**Triage**: 영향 user(s) 식별 (audit_log + LLM gateway log)
**Contain**:
- 의심 user 의 credit 즉시 0 + endpoint 차단
- rate limit 임시 강화 (`/api/interviews/*`, `/api/desk`, `/api/insights/finalize`, `/api/probing/*` → 5/min/user)
- LLM provider 측 API quota 임시 감소 (대시보드 또는 키 회전)
**Eradicate**:
- abuse 패턴 분석 (prompt injection? 정상 high-usage user?)
- 정상 user 면 quota plan upgrade, abuse 면 ToS 위반 처리
- prompt injection 의 경우 즉시 SEC-009 fix PR (SEC1 PR-SEC9)
**Recover**: rate limit 정상화 + monitoring 강화
**Post-mortem**: detection lag / 비용 합계 / prevention

### 5.3 Runbook C — credential stuffing 시도 (P1)

**탐지**: audit_log 의 multiple_login_failed events + 동일 IP/24 / UA
**Triage**: 영향 계정 수, attacker IP 분포, success rate
**Contain**:
- 의심 IP/24 → Vercel Firewall WAF rule 차단
- 영향 계정 → 비밀번호 강제 reset + 모든 session revoke
- (Cloudflare Turnstile 도입 후) 로그인 폼에 challenge 강제
**Eradicate**:
- 정상 user 의 reset 안내 메일
- 침해 의심 계정 → owner 직접 contact
**Recover**: rate limit + WAF rule 점진 완화
**Post-mortem**: source IP 분석, 패턴 추적, monitoring 개선

### 5.4 Runbook D — DB 변경 실수 (P1, 데이터 손실 가능)

**탐지**: post-deploy sanity SQL / 사용자 신고 / data integrity check
**Triage**:
- 영향 row 식별
- backup PITR 시점 확인 (Supabase Pro tier 7일)
- recovery vs in-place fix 결정
**Contain**:
- 같은 migration / endpoint 추가 호출 차단
- 영향 데이터 read 차단 (RLS 강화 또는 endpoint 비활성)
**Eradicate**:
- 데이터 손실 → PITR restore (별 project 로 복원 → 영향 row 추출 → 운영 DB 에 insert)
- 데이터 corruption → reverse migration + clean SQL
**Recover**: data integrity sanity 확인 + monitoring 강화
**Post-mortem**: migration review process 결함 (SOC-013) + lesson learned

### 5.5 Runbook E — OAuth token leak (P0)

**탐지**: GitHub secret scanning / Supabase audit / external report
**Triage**:
- 영향 사용자 수
- token type (Google / Notion / Kakao / Naver)
- token 능력 (Drive read / Notion write / etc)
**Contain**:
- 영향 token 즉시 revoke (vendor API 호출 + DB row delete)
- `user_google_oauth` / `user_notion_oauth` 의 영향 row update
**Eradicate**:
- 침해 원인 분석 (DB dump? code log? backup leak?)
- 근본 fix (SEC-010 의 pgsodium 도입 가속화)
- 영향 사용자에게 re-auth 요청 + 통지
**Recover**: vendor 측 모니터 + 사용자 재연결
**Post-mortem**: leak vector 분석 + crypto 적용

### 5.6 Runbook F — DDoS (P0)

**탐지**: Vercel L3/L4 자동 mitigation + L7 anomaly (rate limit hit polarization)
**Triage**: traffic 분포, geographic distribution, request 패턴
**Contain**:
- Vercel Firewall WAF Attack Mode 활성 (대시보드)
- Cloudflare 또는 Vercel BotID 도입 (즉시)
- rate limit 임시 강화
**Eradicate**: 공격 패턴 분석 → 영구 WAF rule 추가
**Recover**: Attack Mode 해제 + 정상 traffic 회복
**Post-mortem**: vendor support 측 데이터 + 우리 측 추가 protection

---

## 6. Post-mortem 템플릿

`docs/incidents/YYYY-MM-DD-<short-id>.md`

```markdown
# Incident <short-id> — <one-line title>

- **Date**: YYYY-MM-DD
- **Severity**: P0 / P1 / P2 / P3
- **Status**: resolved / mitigated / ongoing
- **IC**: <name>
- **Author**: <name>
- **Reviewed by**: CISO (chrislee)

## 1. Summary
한 단락. 무엇이 일어났고 어떻게 해결했는지.

## 2. Impact
- 영향 사용자 수:
- 영향 데이터 카테고리:
- 영향 도메인 (예: transcripts / billing / auth):
- 비용 영향 (LLM bill / Supabase tier / 등):
- 통지 SLA 적용 여부 + 결과:

## 3. Timeline (UTC)
- HH:MM — first signal (detected via X)
- HH:MM — IC engaged
- HH:MM — severity classified as P?
- HH:MM — containment action (예: WAF rule 추가)
- HH:MM — eradication start
- HH:MM — recovery start
- HH:MM — service fully restored
- HH:MM — post-mortem started

## 4. Root cause
why-1 / why-2 / why-3 (5 whys 또는 fishbone). 근본 원인.

## 5. What went well
- ...

## 6. What went poorly
- ...

## 7. Action items
| ID | 작업 | 책임자 | 마감 | PR / ticket |
|---|---|---|---|---|
| AI-1 | ... | chrislee | 2026-MM-DD | PR-#xxx |
| AI-2 | ... | ... | ... | ... |

## 8. Lessons learned
- ...

## 9. Evidence / artifacts
- Slack thread: `#incident-<id>`
- Vercel deploy: <url>
- Supabase audit: <screenshot path>
- Sentry issue: <url>
- audit_log query result: <sql + result>
```

---

## 7. On-call & escalation

### 7.1 현재 상태 (Critical Gap)

- **on-call rotation**: 단일 운영자 (chrislee). 부재 / 휴가 / 수면 시 대응 0
- **escalation path**: 없음. founder = CISO = CEO 동일
- **24/7 coverage**: 불가
- **automatic page**: 없음

### 7.2 보강 (PR-SOC-016)

**최소 viable**:
- backup operator 1명 (contractor 또는 새 hire) — production access + IR runbook 숙지
- PagerDuty / Opsgenie / Better Stack — Sentry/audit_log alert → 페이지
- 단순 시작: Slack `#alerts` channel + on-call 의 phone notification

**Type 2 evidence**:
- on-call 정기 schedule (e.g., 주간 rotation)
- escalation 사례 (실 발생) + 응답 시간 기록

---

## 8. Communication 채널 매트릭스

| 채널 | 사용 시점 | 책임자 |
|---|---|---|
| Slack `#incident-<id>` | P0 / P1 작업 채널 | IC |
| Slack `#alerts` | 자동 alert | system → IC |
| Email (사용자 통지) | 영향 받은 사용자 통지 | 영업 / IC |
| Email (founder / 영업) | 내부 stakeholder 통지 | IC |
| Status page (도입 후) | 외부 사용자 통지 | IC |
| GitHub Issue (post-mortem link) | 행위 추적 | IC |
| Linear ticket | follow-up 작업 추적 | IC |
| KR PIPC 신고 portal | 한국 PIPA 통지 | CISO |
| EU supervisory authority | GDPR Art. 33 | CISO + DPO |

---

## 9. Tabletop drill (Type 1 audit prerequisite)

**의무**: 정책 작성만으로는 부족. 최소 1회 tabletop drill 시연 → Type 1 audit 시 evidence 로 사용.

**Tabletop scenarios** (1회 / 분기, 1~2시간):
1. "Supabase region outage" — runbook A
2. "credential stuffing 의심" — runbook C
3. "LLM 비용 10x spike" — runbook B

**Drill 절차**:
1. IC (chrislee) 가 시나리오 제시
2. 참여자 (chrislee 단독 단계에선 self-talk) 가 runbook 단계별 행위 시뮬레이션
3. 시간 측정 + 단계별 의사결정 기록
4. drill report `docs/incidents/drill-YYYY-MM-DD.md`
5. 의 발견 → runbook v2 갱신

---

## 10. SOC 2 evaluator 질문 prep

| 질문 | 우리 답 (현재) | 보강 후 답 |
|---|---|---|
| "인시던트 어떻게 정의?" | 구두 ad-hoc | 이 문서 §1 |
| "분류 어떻게?" | (없음) | §2 severity matrix |
| "응답 절차?" | (없음) | §3 6-단계 |
| "통지 SLA?" | (없음) | §4 매트릭스 |
| "post-mortem 작성 의무?" | (없음) | §3.6 + §6 템플릿 |
| "최근 incident 처리 사례?" | (없음) | `docs/incidents/` 의 실 사례 + drill log |
| "on-call rotation?" | 단일 | (보강 후) backup + PagerDuty schedule |
| "GDPR Art. 33 72h 어떻게 ?" | (없음) | §4.1 + 시나리오 drill |

---

## 11. 후속 조치 요약

| ID | 우선순위 | 작업 | size |
|---|:-:|---|---|
| `SOC-001` | **P0-S** | 이 문서 v1 finalize + CISO sign-off + 1회 tabletop drill | M |
| `SOC-003` | P0-S | Sentry 도입 + Slack alert (SEC-012 와 동일, 우선순위 격상) | L |
| `SOC-016` | P1-S | backup operator + PagerDuty/Opsgenie | XL (org) |
| `SOC-028-IR` | P1-S | status page 도입 (Statuspage / Better Stack) | M |
| `SOC-029-IR` | P2-S | quarterly tabletop drill cadence + cyber liability 보험 검토 | M |

---

## 12. 결론

현재 incident response = **무**. 이 문서 v1 + 1회 tabletop drill + Sentry 도입 (SOC-003) + backup operator (SOC-016) 만 완료해도 Type 1 통과 가능. Type 2 는 6mo+ 실 incident handling evidence (drill 4회 + 실 incident post-mortem) 누적 필요. **이 문서가 그대로 `docs/runbook-incident-response.md` 로 승격 가능** — CISO sign-off + drill 후 v1.0 확정 + 분기 1회 review.
