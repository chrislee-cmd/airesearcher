# 중앙 에러 관측 (Error Observability) — 설계 SSOT

이 문서는 제품 전체 에러 관측 시스템의 **단일 설계 기준**입니다. 후속 Phase
스펙(이메일 digest·incident 메모·writer 통합)은 이 문서의 스키마·마커·컴포넌트
경계를 그대로 따릅니다.

> **상태**: Phase 1(소스 계층) 구현됨 — `error_events` 스키마 + `logError()` +
> billing/interview catch 계측 + widgetHealth job-fail 스윕 + DB 로그 폴링 cron.
> Phase 2~4 는 미착수(아래 로드맵).

---

## 1. 목표 — 닫힌 루프

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                          error_events (단일 소스)                     │
 │   signature dedup · feature/code · count · first/last_seen           │
 │   alerted_at (이메일 마커) · memoized_at (메모 마커) · resolved_at    │
 └──────────────▲───────────────────────────────────────┬──────────────┘
                │ ingest                                 │ consume
   ┌────────────┴────────────┐              ┌────────────┴─────────────┐
   │ 1. logError() (앱 catch) │              │ 3. 이메일 digest (P2,prod)│──▶ 파운더 인지
   │ 2. widget job-fail 스윕  │              │ 4. incident 메모 (P3,local)│──▶ writer 검토
   │ 2. DB 로그 폴링 (cron)   │              └────────────┬─────────────┘         │
   └─────────────────────────┘                           │                       ▼
                                                          └──────────▶ 5. fix 스펙 (writer→jarvis)
```

**루프 한 줄 요약**: `에러 식별 → 이메일 digest(P2) + incident 메모(P3) → writer
검토 → fix 스펙`. 이 문서가 세우는 것은 그 루프가 도는 **단일 소스 `error_events`**
와 거기에 에러를 흘려넣는 **인제스트 계층**(Phase 1)입니다.

---

## 2. Prod / Local 분리 (핵심 제약)

Vercel 함수(prod)는 파운더 로컬 파일시스템(`~/jarvis/inbox/incidents/`)에 쓸 수
없습니다. 그래서 **소스는 하나(`error_events`, DB)** 로 두되, **소비자는 실행
환경에 따라 갈립니다**:

| 컴포넌트 | 실행 위치 | 이유 |
|---|---|---|
| ingestion (logError·스윕·DB폴링) | **prod** (Vercel 함수/cron) | 에러가 나는 곳이 prod |
| 이메일 digest (P2) | **prod** (Vercel cron) | 이메일 발송은 네트워크 — 어디서든 가능, prod cron 이 자연스러움 |
| incident 메모 (P3) | **local** (jarvis 스윕) | 파일 쓰기는 로컬 전용. jarvis 가 `error_events` 를 읽어 `~/jarvis/inbox/incidents/` 로 씀 |
| writer 통합 (P3) | **local** (writer 세션) | 메모 → 검토 → fix 스펙 |

`error_events` 가 prod DB 에 있으므로 local jarvis 도 (service_role/Management API 로)
읽어갈 수 있습니다 — 소스는 공유, 마커(`alerted_at` / `memoized_at`)로 두 소비자가
독립적으로 dedup.

---

## 3. 컴포넌트 5개

### (1) ingestion — 이 PR
- **`logError()`** (`src/lib/observability/log-error.ts`): 앱 catch 에서 한 줄 호출.
  signature 계산 → `record_error_event` RPC upsert. **절대 throw 안 함**(best-effort).
- **widget job-fail 스윕** (`src/lib/observability/widget-error-sweep.ts` +
  `api/cron/widget-error-sweep`): `admin/analytics.ts` 의 `WIDGET_HEALTH_SOURCES`
  레지스트리를 SSOT 로 재사용. 각 위젯 job 테이블의 신규 fail 행을 error_events 로
  적재 — 개별 catch 없이 전 위젯 커버.
- **DB 로그 폴링** (`api/cron/error-log-poll`): Supabase Management API 로 postgres
  에러 로그를 주기 조회. 앱 catch 로 못 잡는 DB 계층 에러(`column does not exist`,
  `statement timeout`) 커버.

### (2) grouping / dedup — 이 PR (스키마 레벨)
signature = `sha256(feature + '|' + code + '|' + normalize(message))`. 같은 원인의
재발은 신규 행이 아니라 기존 행의 `count++` / `last_seen` 갱신. occurrence flood 가
행 하나로 collapse → 메모/이메일 flood 방지.

### (3) 이메일 digest — Phase 2 (미착수)
prod Vercel cron 이 `error_events` 에서 `alerted_at IS NULL AND resolved_at IS NULL`
행을 모아 파운더에게 1 run = 1 이메일. 보낸 행에 `alerted_at` 스탬프(dedup).
`interview-failure-alert` cron 의 일반화 — nodemailer + Gmail SMTP 재사용.

### (4) incident 메모 — Phase 3 (미착수, jarvis 툴링)
local jarvis 스윕이 `error_events` 에서 `memoized_at IS NULL AND resolved_at IS NULL`
행을 읽어 `~/jarvis/inbox/incidents/<slug>.md` 메모 생성. 메모 만든 행에 `memoized_at`
스탬프. **incident 단위 dedup** — 같은 signature 는 메모 1개.

### (5) writer 통합 — Phase 3 (미착수)
writer 세션이 incident 메모를 검토 후 fix 스펙으로 승격. **자동이 아님** — 사람
판단(writer)이 우선순위·범위를 정함.

---

## 4. `error_events` 스키마

```sql
create table public.error_events (
  id          uuid primary key default gen_random_uuid(),
  signature   text not null unique,   -- hash(feature + code + normalized message)
  feature     text not null,          -- 'interview'|'billing'|'desk'|'db'|... (widgetHealth 키 정합)
  code        text,                   -- 'chunk_insert_failed'|'statement_timeout'|'checkout_503'...
  message     text,                   -- 대표 메시지(정규화 전 원문 1건, 최신 샘플)
  context     jsonb,                  -- 샘플 id/route/org 등
  severity    text not null default 'error',   -- 'error'|'warn'
  source      text not null,          -- 'app'|'db-poll'|'job-sweep'
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  count       int not null default 1,
  alerted_at  timestamptz,            -- 이메일 digest dedup (Phase 2, prod)
  memoized_at timestamptz,            -- incident 메모 dedup (Phase 3, local)
  resolved_at timestamptz
);
create index error_events_open_idx on public.error_events (last_seen desc) where resolved_at is null;
```

- **upsert on signature** — `record_error_event(...)` RPC(security definer, 멱등):
  최초 → insert, 재발 → `count = count+1, last_seen = now()`, message/context 최신
  샘플로 갱신, resolved 였으면 다시 open(회귀 재발 감지).
- **RLS**: 쓰기는 service_role(RPC 경유)만, 읽기는 super-admin(JWT email 게이트).
- 마이그: `supabase/migrations/20260713111710_error_events.sql`. additive → 머지 시
  자동 적용(PROJECT.md §7.5).

### signature 정규화 규칙 (품질 핵심)

과분할(메모 flood)과 과병합(원인 뭉개짐) 사이의 균형점. `normalizeMessage()` 가
message 안의 가변 토큰을 마스킹한 뒤 해시:

| 패턴 | → 마스크 | 예 |
|---|---|---|
| UUID (8-4-4-4-12) | `<uuid>` | `job 3f2a…-… failed` → `job <uuid> failed` |
| ISO 타임스탬프 | `<ts>` | `at 2026-07-13T11:00:00Z` → `at <ts>` |
| 시:분:초 | `<time>` | `at 12:04:11` → `at <time>` |
| 16진 토큰(0x/8자리+) | `<hex>` | |
| 숫자 열 | `<n>` | `row 4821` → `row <n>` |
| 따옴표 리터럴 | `'<v>'` | `column "foo_x" ...` → `column "<v>" ...` |

**마스킹 규칙을 바꾸면 dedup 경계가 바뀝니다** — 신규 규칙 추가 시 기존 signature
와의 호환(재발 collapse 유지)을 검토하세요.

---

## 5. 결정 기록

- **v1 커버리지 = 앱 + DB 로그 폴링.** 앱 catch(logError) + widget job-fail 스윕이
  앱/잡 계층을, Management API 폴링이 DB 계층을 커버. (사용자 확정 2026-07-13)
- **incident 큐 = `~/jarvis/inbox/incidents/`** (local). 파일 기반, jarvis 스윕이 채움.
- **메모는 incident 단위 dedup + writer 검토 후 스펙(자동 아님).** 노이즈·오탐이
  바로 스펙이 되지 않게 사람 게이트를 둠.
- **이중 마커** — `alerted_at`(이메일, prod) · `memoized_at`(메모, local)로 두
  소비자가 같은 소스를 독립 dedup.
- **DB 폴링 워터마크** — error_events 안의 sentinel 행(reserved signature,
  `resolved_at` 고정)의 `context.until` 에 마지막 폴링 시각 저장. tumbling window
  로 중복 적재 방지. 별도 config 테이블 없이 error_events 하나로 해결.
- **widget 스윕 워터마크** — 시그니처 error_event 의 `last_seen` 을 워터마크로 재사용
  (created_at > last_seen 인 신규 fail 만 집계). 이 역시 별도 저장소 없음.
- **후속 분리 가드(1a/1b)** — spec 은 DB 폴링이 무거우면 1b 로 분리 허용했으나,
  로컬에 `SUPABASE_ACCESS_TOKEN` 이 있어 Phase 1 에 함께 포함(1a+1b). 토큰 미설정
  환경에서는 폴링 cron 이 조용히 no-op(self-observation 만 남김).

---

## 6. Phase 로드맵

| Phase | 범위 | 상태 |
|---|---|---|
| **1** | 소스 계층: `error_events` 스키마 + `logError()` + billing/interview catch 계측 + widget job-fail 스윕 + DB 로그 폴링 cron + 이 설계 SSOT | **이 PR** |
| **2** | 이메일 digest cron (prod): open 행 → 파운더 1 run = 1 이메일, `alerted_at` dedup. `interview-failure-alert` 일반화 | 미착수 |
| **3** | incident 메모 (local jarvis 스윕): open 행 → `~/jarvis/inbox/incidents/` 메모, `memoized_at` dedup + writer 통합(메모→검토→fix 스펙) | 미착수 |
| **4** | resolve 루프 + 대시보드: super-admin `/admin` 에 open error_events 뷰, `resolved_at` 수동/자동 마킹, 회귀 재발 하이라이트 | 미착수 |

---

## 7. 계측 지점 (Phase 1 적재 경로)

| feature | code | 위치 | source |
|---|---|---|---|
| `billing` | `pack_checkout_503` / `pack_checkout_failed` | `api/billing/checkout` | app |
| `billing` | `subscription_checkout_503` / `subscription_checkout_failed` | `api/billing/subscription/checkout` | app |
| `billing` | `order_grant_failed` / `subscription_grant_failed` | `api/billing/webhook` | app |
| `interview` | `index_failed` | `api/interviews/index` | app |
| `interview` | `convert_extract_failed` | `api/interviews/convert` | app |
| `interview` | `topline_failed` | `lib/interview-v2/topline.ts` (runTopline) | app |
| `desk`/`insights`/`transcript`/`interview`/`translate` | `job_failed` | widget 스윕 (레지스트리 기반) | job-sweep |
| `db` | `statement_timeout`/`undefined_object`/`unique_violation`/… | DB 로그 폴링 | db-poll |
| `observability` | `db_poll_failed`/`db_poll_unconfigured` | DB 폴링 self-observation | db-poll |

**회귀 0 원칙**: 모든 계측은 기존 실패 처리(error_message·console.error·status flip)
**옆에** 병행 적재 — 기존 동작을 바꾸지 않습니다.
