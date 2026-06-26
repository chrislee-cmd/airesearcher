# 보안 audit — 데이터 흐름 + 외부 서비스 매핑 (GDPR 핵심)

- **버전**: 1.0 (2026-06-26)
- **상위 문서**: `docs/security-audit-baseline-2026-06-26.md`
- **목적**: GDPR Article 28/30/32/44–49 응답 — 어느 데이터가 어디로 가는지, 누가 처리자 (processor) 인지, EU→US 전송 적합성

---

## 1. 전체 데이터 흐름 (mermaid)

```mermaid
flowchart TB
  subgraph Browser["Browser (EU 사용자)"]
    User[사용자 입력<br/>오디오/비디오/텍스트/PII]
    Cookie[Supabase auth cookie<br/>+ Mixpanel localStorage]
  end

  subgraph EdgeOrFunc["Vercel Functions (US-primary)"]
    Next[Next.js 16 App Router<br/>API routes 110개]
    Cron["Vercel Cron<br/>/api/translate/cleanup (1h)"]
  end

  subgraph DB["Supabase (region 미고정 — us-east-1 추정)"]
    Auth[Supabase Auth<br/>JWT 세션]
    Postgres["Postgres + RLS<br/>40+ 테이블"]
    Storage["Supabase Storage<br/>audio-uploads, video-uploads<br/>(private bucket)"]
    Realtime[Postgres realtime<br/>(insights / desk / translate channels)]
  end

  subgraph LLM["LLM Providers (US)"]
    OAI["OpenAI<br/>gpt-4o, gpt-4o-mini-transcribe<br/>+ Realtime (voice/translate)"]
    Anthropic["Anthropic<br/>Claude (insights, chat, reports)"]
    Gemini["Gemini<br/>(env 등록만, 미사용)"]
  end

  subgraph SpeechVid["Speech / Video"]
    Deepgram["Deepgram<br/>전사 (audio → text)"]
    EL["ElevenLabs<br/>전사 + TTS"]
    LK["LiveKit<br/>WebRTC 인프라"]
    TL["Twelvelabs<br/>비디오 indexing"]
  end

  subgraph Payment["Payment"]
    Stripe[Stripe]
    LS[Lemon Squeezy]
  end

  subgraph OAuthAndShare["OAuth / 외부 share"]
    Google["Google APIs<br/>OAuth + Forms + Sheets + Docs"]
    Notion["Notion API + OAuth"]
    Kakao[Kakao OAuth]
    Naver[Naver OAuth]
  end

  subgraph Analytics["Analytics / Email"]
    MP["Mixpanel (US)<br/>email = distinct_id"]
    Mail["Gmail SMTP<br/>nodemailer"]
  end

  User -->|HTTPS / TLS| Next
  Next --> Auth
  Next -->|RLS-scoped queries| Postgres
  Next -->|signed upload URL| Storage
  Storage -->|signed download| Browser

  Next -->|prompt + PII text| OAI
  Next -->|prompt + PII text| Anthropic
  Next -->|raw audio| Deepgram
  Next -->|raw audio + tts text| EL
  Next -->|video bytes| TL

  Next -->|server SDK token mint| LK
  LK -.->|WebRTC stream<br/>P2P or SFU| Browser

  Deepgram -.->|webhook HMAC| Next
  EL -.->|webhook HMAC| Next

  Next -->|checkout intent / portal| Stripe
  Next -->|checkout / customer portal| LS
  Stripe -.->|webhook| Next
  LS -.->|webhook HMAC| Next

  Next -->|OAuth code → token| Google
  Next -->|OAuth code → token| Notion
  Browser -->|OAuth| Kakao
  Browser -->|OAuth| Naver

  Browser -->|email + UUID + 행동| MP
  Cron --> Postgres
  Next --> Mail

  classDef us fill:#fee,stroke:#c00,color:#000
  classDef eu fill:#efe,stroke:#0a0,color:#000
  classDef unknown fill:#ffe,stroke:#a90,color:#000
  class OAI,Anthropic,Gemini,Deepgram,EL,TL,Stripe,LS,MP,Mail,Google,Notion us
  class Kakao,Naver unknown
  class DB unknown
```

색 의미: **빨강** = US, **노랑** = 미정 (리전 코드 pin 없음), **초록** = EU (현재 없음)

---

## 2. PII 분류 (데이터 카테고리별)

| 카테고리 | 정의 | 우리 시스템의 예 |
|---|---|---|
| **Identifier** | 단일로 개인 식별 | email, full_name, OAuth refresh_token, attendee phone |
| **Quasi-identifier** | 결합으로 식별 | org_id + role + created_at, IP/24 + UA |
| **Sensitive PII** | 노출 시 피해 큼 | 음성 transcript text, video analysis text, insights_quotes.text, interview chunk, scheduler note |
| **Financial PII** | 결제·세금 | payments.tax_invoice (사업자번호/대표자명/주소), bank_reference, stripe_session_id |
| **Behavioral** | 행동 추적 | mixpanel event, credit_transactions.reason, voice_sessions.entry_route |
| **Special category (GDPR Art. 9)** | 건강·생체·정치·종교·민감 | **잠재적**: interview 내용에 따라 보건/심리/소수자 발화 포함 가능 — DPIA 시 명시 |

---

## 3. 단계별 데이터 흐름 (시나리오 단위)

### 3.1 시나리오 A — 사용자가 인터뷰 오디오를 업로드해 transcript 생성
1. Browser → `/api/transcripts/upload-url` (POST, auth) → Supabase Storage signed URL 발급
2. Browser → Supabase Storage (`audio-uploads` private bucket) 에 audio 직접 upload (PII: 음성)
3. Browser → `/api/transcripts/start` → `transcript_jobs` insert (status=pending) + Deepgram (또는 ElevenLabs) async job 시작 (data: audio storage key + webhook secret)
4. Deepgram → 처리 후 → `/api/transcripts/webhook/route.ts` callback (HMAC 검증) → `transcript_jobs.raw_result` + `markdown` 업데이트, `transcript_jobs.markdown` 에 **사용자/제 3자 발화 전문** 저장
5. (선택) Anthropic Claude 로 정제 (`/api/interviews/convert/route.ts`)
6. UI 표시 — RLS 로 org member 만 조회

**PII 흐름**: 음성 (Deepgram US) → 텍스트 (Supabase) → 정제 텍스트 (Anthropic US) → UI
**보유 위치**: Supabase audio bucket + transcript_jobs.markdown + Deepgram (default 30일?) + Anthropic (API default zero-retention 추정 but DPA 확인 필요)

### 3.2 시나리오 B — 실시간 통역 세션 (live translate)
1. host → `/api/translate/sessions` (POST) → `translate_sessions` insert + LiveKit room 생성 (server SDK token mint)
2. host & viewer → LiveKit WebRTC join (audio stream P2P/SFU)
3. host → OpenAI Realtime (`/api/translate/sessions/[id]/ephemeral` 가 ephemeral token 발급, 클라이언트가 직접 OpenAI websocket 사용)
4. OpenAI Realtime 이 transcription + translation 출력 → 클라이언트가 `/api/translate/sessions/[id]/messages` POST → `translate_messages.text` 저장 (record_enabled=true 인 경우만)
5. 익명 viewer 가 공유 token 으로 `/api/translate/public/[token]/transcript-since` 호출 → `translate_messages` 의 새 row 만 backfill
6. Cron (`/api/translate/cleanup`, 1h) — expired session ended 마킹 + `share_token` null

**PII 흐름**: 음성 (LiveKit) → OpenAI Realtime (US) → 번역 텍스트 (Supabase) → 익명 viewer
**위험**: record_enabled UI 가 사용자 명시 동의 UX 인지 확인 필요. translate_messages 의 retention 자동 삭제 없음 — SEC-015

### 3.3 시나리오 C — Insights 분석 (인터뷰 → quote 추출 → 클러스터)
1. `/api/insights/start` — 파일 메타 검증 + job 생성 (`insights_jobs`)
2. `/api/insights/files` — 파일 업로드 + Pandoc/libreoffice 로 markdown 변환 (SEC-018 MIME 검증 없음)
3. `/api/insights/finalize` — Anthropic Claude 에 markdown 청크 송신 → quote / cluster / contradiction / tension 추출 결과 DB 저장
4. `insights_quotes.participant_name + text` — **연구 respondent 의 PII**

**PII 흐름**: 사용자 업로드 파일 (3자 발화 포함 가능) → Anthropic (US) → insights_quotes (Supabase)
**GDPR Art. 14**: 인터뷰 respondent 는 우리 user 가 아닌 3자 — 별도 통지 의무. 현재 use-policy.md 가 "user 가 책임" 이라 명시했으나, 공동 controller 책임 (Art. 26) 여지 있음

### 3.4 시나리오 D — Desk research (외부 article 크롤 + LLM 종합)
1. `/api/desk` — keywords (사용자 입력) + 검색 → 외부 article 수집 → Anthropic 으로 RQ decompose + claim extract + 종합
2. 결과 `desk_jobs.output` (markdown) + `desk_research_extract`

**PII 흐름**: 키워드 (사용자) + crawled article (3자 source) → Anthropic (US) → DB
**위험**: prompt injection 표면 SEC-009 (keywords / article snippet 가 plain interp)

### 3.5 시나리오 E — 결제
1. `/api/billing/checkout` (POST, auth) → Stripe / Lemon Squeezy hosted checkout URL
2. 사용자가 hosted checkout 에서 카드 입력 (PCI scope = processor 측)
3. webhook → `/api/billing/webhook` (HMAC) → `payments.status='paid'` + credit_grants insert + organizations.credit_balance 업데이트
4. (Korea 사업자) tax_invoice JSONB 에 사업자번호 / 대표자명 / 주소 저장

**PII 흐름**: 카드 (Stripe/LS 만), tax 정보 (DB 평문) → SEC-016
**보유**: 5년 (전자상거래법 legal hold)

### 3.6 시나리오 F — 무료 trial 등록 (사기 방지)
1. 신규 가입 → `/api/auth/trial-init` → SHA-256 fingerprint hash + IP + IP/24 를 `trial_fingerprints` insert
2. 이미 동일 fingerprint 존재 시 trial credit 부여 안 함

**PII 흐름**: IP / UA / device fingerprint (Supabase) — SEC-015 자동 삭제 cron 없음

### 3.7 시나리오 G — Mixpanel 분석
1. 로그인 시 `mixpanel.identify(email)` + 모든 페이지뷰 + 일부 click event
2. `localStorage` 에 distinct_id (= email) 저장 — EU 사용자 구분 없이

**PII 흐름**: 이메일 + UUID + 행동 → Mixpanel (US, default residency)
**위험**: SEC-007 동의 없이 init

---

## 4. 외부 서비스별 매핑 (Art. 28 + 44–49)

| 처리자 | 본사 / 데이터 위치 | 우리가 보내는 데이터 | 데이터 카테고리 | DPA 공개 | EU 적합성 메커니즘 | 위험 등급 |
|---|---|---|---|---|---|---|
| **Vercel** | US (글로벌 edge) | source / 로그 / 요청 context / function arg | metadata + 로그 | ✓ vercel.com/legal/dpa | SCC + EU-US Data Privacy Framework (DPF) certified | LOW |
| **Supabase** | AWS (region 미고정 — 코드에 명시 없음) | 전체 PII + 인증 토큰 | ALL | ✓ supabase.com/security/dpa | region 이 EU 면 SCC 불필요, US 면 SCC 필수. **현재 미확인** | **HIGH (region 확인 필요)** |
| **OpenAI (API)** | US | transcript / 인터뷰 텍스트 / 키워드 / Realtime audio | Sensitive PII | ✓ openai.com/policies/data-processing-addendum | SCC + DPF. **zero-retention header (`OpenAI-Beta`) 미사용** → 30일 기본 보존 | **HIGH** |
| **Anthropic (Claude)** | US/글로벌 | insights / chat / report 입력 (PII 포함) | Sensitive PII | ✓ anthropic.com/legal/dpa | SCC + DPF. API 기본 zero-retention (모델 학습 미사용) — 확인 권장 | MEDIUM |
| **Deepgram** | US | raw audio + speaker | Sensitive PII (생체 가능성) | ✓ deepgram.com/legal | SCC + DPF | MEDIUM |
| **ElevenLabs** | US/EU | text → TTS, 전사 audio | Sensitive PII | ✓ elevenlabs.io/legal/dpa | SCC. zero-retention enterprise plan 옵션 | MEDIUM |
| **LiveKit** | Distributed (Cloud tier 면 multi-region) | WebRTC SFU (audio stream) | Sensitive PII | ✓ livekit.io/legal/dpa | tier 따라 EU region 선택 가능. **현재 config 미확인** | MEDIUM-HIGH |
| **Twelvelabs** | US | video bytes + analysis prompt | Sensitive PII | ✓ twelvelabs.io/dpa | SCC | MEDIUM |
| **Stripe** | Global (Ireland EU) | 결제 metadata, customer | Financial PII | ✓ stripe.com/legal/dpa | EU subsidiary 처리 가능 + SCC | LOW |
| **Lemon Squeezy** | US (Stripe 기반 MoR) | 결제 metadata | Financial PII | ✓ lemonsqueezy.com/legal/dpa | SCC + DPF | LOW |
| **Google APIs (OAuth + Forms + Sheets + Docs)** | US/Global | OAuth refresh token + Forms response | Identifier + Sensitive | ✓ cloud.google.com/terms/data-processing-addendum | SCC + DPF | MEDIUM |
| **Notion** | US | OAuth access token + content export | Identifier + Sensitive | ✓ notion.so/notion/dpa | SCC + DPF | MEDIUM |
| **Mixpanel** | US (EU residency 옵션 있음) | email + UUID + 행동 | Behavioral PII | ✓ mixpanel.com/legal/dpa | EU residency 별도 활성 필요. **현재 default = US** | **HIGH (EU residency 미설정 + 동의 없음)** |
| **Kakao OAuth** | Korea | OAuth token + email | Identifier | (한국 PIPA 적용) | 한국 처리. EU 사용자 데이터 한국 전송 시 별도 평가 (한국은 GDPR adequacy decision 보유 ✓) | LOW |
| **Naver OAuth** | Korea | OAuth token + email | Identifier | (한국 PIPA 적용) | 한국 adequacy decision ✓ | LOW |
| **Gmail SMTP (nodemailer)** | US | 메일 내용 + 수신자 email | Identifier | ✓ Google Workspace DPA | SCC + DPF | LOW |

### 4.1 Adequacy decisions / DPF 상태 (2026 기준)
- **EU → US**: 2023.07 EU-US Data Privacy Framework (DPF) certified 처리자는 SCC 없이 전송 가능. OpenAI / Anthropic / Vercel / Stripe / Mixpanel / Google / Notion 등 거의 모두 DPF 인증됨 (확인 권장)
- **EU → Korea**: 2021.12 한국 adequacy decision — 한국 처리자에게는 SCC 없이 전송 가능
- **결론**: 처리자 자체 DPF/adequacy 가 있어 SCC 부담은 줄지만, **Meteor Research 가 각 처리자와 서면 DPA 를 체결했는지** + **사용자에게 명시 disclosure** 했는지가 별개 의무

---

## 5. Supabase region 확인 절차 (P0)

코드에 region pin 없음 (`createClient({ url: SUPABASE_URL, ... })` 만 사용). 확인 방법:
```bash
# Supabase 대시보드 → Settings → General → Region
# 또는
curl -sI "$NEXT_PUBLIC_SUPABASE_URL" | grep -i x-region   # 헤더에 노출 안 될 수 있음
```
- 만약 `us-east-1` 또는 비-EU 리전 → EU 사용자 데이터에 대해 SCC + DPA + 명시 통지 필요
- 또는 EU 리전 (eu-west-1, eu-central-1) 으로 신규 project migrate (downtime cost)

---

## 6. zero-retention / no-training 설정 권장 (LLM)

### OpenAI
- Standard API: default 30일 보존 (abuse monitoring). zero-retention 은 enterprise / ZDR endpoint 또는 데이터 처리 협의 후 활성
- 모델 학습 opt-out: API tier 는 default opt-out (chat completion API 는 학습에 미사용)
- 권장: API request 시 `OpenAI-Beta: ...` 또는 enterprise 계약 검토. 우리 spendCredits 가 이미 per-org 제한 — 동의 + ZDR 활성 합치면 EU 안전

### Anthropic
- API 기본 zero-retention (모델 학습 미사용). 추가 설정 불필요
- DPA 서명만 확인

### Deepgram
- enterprise plan 에서 zero-retention 옵션. 현재 plan 확인 권장

### ElevenLabs
- enterprise 에서 zero-retention. consumer plan 은 ToS 에 따라 일부 보존

---

## 7. 사용자 데이터의 라이프사이클

| stage | trigger | 어떤 데이터 | 보존 정책 (현재) | GDPR 적합성 |
|---|---|---|---|---|
| 수집 | 가입 | email, full_name, password hash, OAuth identifier | 영구 (계정 활성 동안) | Art. 6(1)(b) contract — OK |
| 수집 | 첫 방문 | IP, UA → trial_fingerprints | 7일 (인덱스, but cron 없음 SEC-015) | Art. 6(1)(f) legitimate interest — 명시 필요 |
| 수집 | 콘텐츠 업로드 | audio / video / docx → Storage + transcript_jobs.markdown | 영구 (사용자 삭제까지) | Art. 6(1)(b) — OK |
| 처리 | LLM 호출 | transcript 텍스트, keywords, interview text → OpenAI / Anthropic | 처리자 측 30일 (OpenAI default) | Art. 28 + 44–49 — DPA + SCC + 동의 필요 |
| 처리 | 분석 | quotes / clusters → insights_* | 영구 | Art. 6(1)(b) — OK, but 정정권 (Art. 16) 부재 |
| 보존 | 결제 | tax_invoice + receipt → payments | 5년 (전자상거래법) | Art. 6(1)(c) legal obligation — OK |
| 익명화 | 없음 | — | — | (gap) |
| 삭제 | 사용자 삭제 요청 | (UI 없음) | (코드 없음 SEC-004) | Art. 17 — **위반** |
| 삭제 | 회원 탈퇴 | (UI 없음) | (코드 없음) | Art. 17 — **위반** |
| 삭제 | 자동 retention | translate session expire | 4h 기본 (마킹만, hard delete 아님) | 부분 충족 |

---

## 8. 즉시 조치 매핑 (이 데이터 흐름에서 도출되는 fix)

| 데이터 흐름 위험 | 조치 | PR 후보 (followups.md) |
|---|---|---|
| Supabase region 미확인 | dashboard 에서 region 확인 → us 면 EU 사용자 SCC 또는 migrate | PR-SEC11 |
| OpenAI 30일 보존 | enterprise / ZDR 활성 + 동의 흐름 | PR-SEC10 |
| Mixpanel US + 동의 없이 init | consent gate + EU residency 또는 privacy-friendly 대체 (Plausible 등) | PR-SEC8 |
| 익명 사용자 LLM 비용 abuse | 어플리케이션 rate limit (SEC-003) | PR-SEC4 |
| respondent (3자) PII 처리 | use-policy 업데이트 + scheduler/insights 입력 폼에 "consent 받았는가" 체크 | PR-SEC12 |
| trial_fingerprints / voice_messages 영구 보존 | retention cron (`/api/cron/retention`) 추가 | PR-SEC5 동봉 |
| LLM 응답이 PII 를 재가공 | 응답 schema 검증 + 익명화 옵션 | (post-launch) |

---

## 9. 데이터 카테고리별 처리자 매핑 (한 줄 요약)

- **Identifier (email, name)** → Supabase + Mixpanel + OAuth providers + Gmail SMTP
- **OAuth token** → Supabase (평문 SEC-010) + Google/Notion 측
- **음성 / 영상 raw** → Supabase Storage + Deepgram / ElevenLabs / Twelvelabs / OpenAI Realtime / LiveKit
- **전사 / 인터뷰 text** → Supabase + Anthropic / OpenAI
- **insights quote** → Supabase + Anthropic
- **결제 / 세금** → Stripe / Lemon Squeezy + Supabase (payments.tax_invoice 평문 SEC-016)
- **IP / fingerprint** → Supabase (trial_fingerprints) + Vercel logs + (Mixpanel)
- **행동 event** → Mixpanel (US default)

각 카테고리의 사용자 권리 행사 흐름 (조회 / 삭제 / 이동) 이 현재 모두 manual email 의존 → SEC-005 / SEC-004 / SEC-008 의 핵심 fix.

---

## 10. 결론 (DPO 관점)

- 처리자 자체는 evidence-based 로 모두 GDPR 적합 (DPF 인증 다수). DPA 서명 단순 확인만 남음
- **고객 (Meteor Research) 측 책임 영역** 이 거의 비어 있음:
  - Supabase region 코드 pin / 명시
  - LLM 처리자에 zero-retention 협의
  - Mixpanel 동의 gate 또는 alternative
  - 사용자 동의 / 권리 endpoint (Art. 15/17/20)
  - ROPA / DPIA / 침해 통지 절차
- **6~8주 PR 시퀀스** 로 GDPR audit-ready 도달 가능. 후속 PR list 는 `docs/security-audit-followups.md`
