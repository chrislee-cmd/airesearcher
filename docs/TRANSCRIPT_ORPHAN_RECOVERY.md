# 전사록 / 게이트 prod 청소 런북 (P0 즉시 언블록 + 고아 파일 복구)

> **한 줄 요약.** org 동시사용 게이트 정원이 *유령 슬롯 + stuck `submitting`* 으로
> 점유돼 전 유저 전사가 막혔고(P0), `audio-uploads` 버킷에는 `transcript_jobs`
> row 가 없는 *고아 파일 ≥11건*(유료 데이터)이 남아 있습니다. 이 문서는 둘을
> **dry-run → 승인 → apply** 순서로 청소/복구하는 절차입니다.

관련: card #550 · #549(row-first 핸드오프, 재발 방지) · #551(클라 타임아웃) ·
#552(백엔드 유령 슬롯 sweep/TTL 수리) · #546/#548(멈춘·실패 잡 표면화).

---

## ⚠️ 실행 승인 게이트 (먼저 읽으세요)

이 런북의 모든 **prod write**(DELETE / UPDATE / INSERT) 는 **승인 게이트** 대상입니다.

| 항목 | 값 |
|---|---|
| **누가 실행하나** | **jarvis / 어드민만** (`service_role`, RLS 우회). 스펙라이터·워커·자동화 **실행 금지**. |
| **언제** | 사용자가 **"실행해"** 라고 명시 승인한 뒤에만. (Part 0/Part 1 각각 별도 승인 가능) |
| **어떻게** | 각 단계는 반드시 **dry-run(SELECT)** 을 먼저 돌려 대상 row 를 눈으로 확인 → 승인 → **apply(DELETE/UPDATE/INSERT)**. |
| **멱등** | 모든 apply 는 재실행 안전(중복 생성/과삭제 없음). 건별 로그 남김. |
| **롤백** | Part 0-2 / Part 1 의 마킹은 `status`/`error_message` 만 바꾸므로 되돌릴 수 있음. Part 0-1 DELETE 는 유령 row 라 롤백 불필요(다음 admit 이 재생성). |

> 승인 완료 기록: **2026-07-10 — 사용자 P0 승인 완료** (source: 사용자 prod bisection).
> 그래도 각 apply 직전 dry-run 산출을 사용자/jarvis 가 한 번 더 확인하고 실행합니다.

실행 채널: Supabase 대시보드 SQL editor **또는** MCP `supabase.execute_sql`
(둘 다 `service_role` 권한). Part 1 스크립트는 `SUPABASE_SERVICE_ROLE_KEY` 로 동작.

---

## Part 0 — [P0 즉시] org 게이트 정원 회복

동시사용 게이트는 두 테이블로 정원을 셉니다 (마이그
`20260709085039_widget_concurrency_gate.sql` + `20260710052715_widget_gate_stale_exclusion_ttl.sql`):

- `public.widget_active_uses` `(widget_key, account_id, admitted_at, last_seen)`
  — 현재 admit 된 슬롯. `last_seen` 이 하트비트(20s)로 갱신됨.
- `public.widget_use_queue` `(widget_key, account_id, enqueued_at, last_poll)`
  — 대기열. `last_poll` 이 poll(5s)로 갱신됨.

`admit_or_enqueue` RPC 는 정원을 셀 때 이미 **stale 을 배제**합니다
(`last_seen >= now() - active_ttl`). 배포된 TTL:

| TTL | 값 | 근거 |
|---|---|---|
| `active_ttl` | **60초** | 하트비트 20s × 3 (마이그 20260710052715, `src/app/api/gate/sweep/route.ts` `ACTIVE_TTL_SECONDS`) |
| `queue_ttl` | **30초** | poll 5s × 6 (동 마이그, sweep `QUEUE_TTL_SECONDS`) |

**그럼 왜 정원이 막혔나** — sweep 이 stale row 를 *물리 삭제*하기 전이거나(#552
이전) sweep 이 안 돌던 구간에 유령 row 가 쌓였습니다. count 는 TTL 로 배제되지만,
잔존 row 자체가 리스트/진단을 오염시키고, TTL 경계 근처 row 가 admit 을 흔듭니다.
Part 0 은 이 잔재를 **한 번에** 물리 청소해 정원을 깨끗이 회복합니다. #552 의
sweep/TTL 수리가 이후 재발을 막습니다 — 이 런북은 **기존 적체 일회성 청소**.

### 0-1. 유령 `widget_active_uses` + stale queue 정리

> 임계는 배포 TTL 을 그대로 씁니다(active 60s / queue 30s). 라이브 세션 오삭제를
> 더 보수적으로 막고 싶으면 아래 `interval` 을 넉넉히(예: `'5 minutes'`) 늘려
> dry-run 으로 대상이 줄어드는지 확인 후 실행하세요. 삭제된 row 는 그 계정이
> 다음 하트비트/admit 때 자연히 재생성되므로 과삭제의 부작용은 "슬롯 재획득 1회"뿐.

**① dry-run (read-only) — 유령 active 슬롯:**
```sql
-- 하트비트 만료(60s 초과)된 admit 슬롯 = 유령
select widget_key, account_id, admitted_at, last_seen,
       now() - last_seen as stale_for
from public.widget_active_uses
where last_seen < now() - interval '60 seconds'
order by last_seen asc;
```

**② dry-run (read-only) — stale 대기열:**
```sql
select widget_key, account_id, enqueued_at, last_poll,
       now() - last_poll as stale_for
from public.widget_use_queue
where last_poll < now() - interval '30 seconds'
order by last_poll asc;
```

**③ apply (승인 후) — 물리 삭제 (멱등):**
```sql
-- 유령 active 슬롯 제거
delete from public.widget_active_uses
where last_seen < now() - interval '60 seconds';

-- stale 대기열 제거 (정합)
delete from public.widget_use_queue
where last_poll < now() - interval '30 seconds';
```

**검증:** 삭제 직후 남은 active 슬롯 수를 위젯별로 확인 → cap 이하인지.
```sql
select widget_key, count(*) as live_slots
from public.widget_active_uses
where last_seen >= now() - interval '60 seconds'
group by widget_key
order by live_slots desc;
```
기대: 각 `widget_key` 의 `live_slots` 가 정원(cap) 미만 → 신규 유저 즉시 admit.
프로덕션에서 fresh 시크릿 로그인 → 전사 위젯 진입 시 "슬롯 대기 중" 이 안 뜨면 해소.

### 0-2. stuck `submitting` transcript_jobs 정리

`transcript_jobs.status='submitting'` 인데 오래 방치된 row 는 리스트에서 영원히
"진행 중" 으로 보이며(예: 5월 3건, `error_message IS NULL`) 실제로는 dispatch 가
끊긴 죽은 잡입니다. 임계(1일) 넘긴 것만 `error` 로 마킹해 표면화(#546/#548)와
정합을 맞춥니다.

> ⚠️ **진짜 진행 중(최근 생성) row 오건드림 금지** — `created_at < now() - 1 day`
> 만 대상. 정상 전사는 분~시간 내 끝나므로 1일 넘게 `submitting` 이면 죽은 잡.

**① dry-run (read-only):**
```sql
select id, user_id, org_id, filename, status, error_message,
       created_at, now() - created_at as stuck_for
from public.transcript_jobs
where status = 'submitting'
  and created_at < now() - interval '1 day'
order by created_at asc;
```

**② apply (승인 후) — error 마킹 (멱등):**
```sql
update public.transcript_jobs
set status = 'error',
    error_message = 'stuck_reconciled'
where status = 'submitting'
  and created_at < now() - interval '1 day';
```

**검증:** 위 dry-run 을 다시 돌려 0건이면 완료. 유저 전사 리스트(#546)에서 해당
잡이 "실패(재시도 가능)" 로 노출됨. 재전사를 원하면 유저가 리스트에서 **재시도**
(→ `/api/transcripts/jobs/[id]/retry`, 기존 storage_key 로 재-dispatch) 하거나
Part 1 의 복구 경로를 씁니다.

> 참고: `updated_at` 은 touch 트리거로 자동 갱신 → 스테일 판정(#546)이 즉시 반영.

---

## Part 1 — 고아 파일 ≥11건 복구

### 진단 — 고아란?

**고아** = `audio-uploads` 버킷에 스토리지 객체(`{user_id}/{ts}-{filename}`)는
있는데, 그 객체를 가리키는 `transcript_jobs` row 가 **없는** 파일. #549(row-first
핸드오프) 이전엔 업로드가 성공해도 gate 무음/배치 실패로 row 생성이 누락돼 파일이
"조용히 사라졌습니다". 유료 유저가 올린 오디오라 복구 대상.

- **소유 복원**: storage 경로 prefix `[1] = user_id` (버킷 RLS 정책 근거,
  마이그 0004 `storage.foldername(name))[1] = auth.uid()::text`).
- **org 복원**: 유저의 활성 org = `organization_members` 를 `created_at ASC` 로
  정렬한 첫 org (앱의 `getActiveOrg` = `getCurrentUserOrgs()[0]` 과 동일 규칙,
  `src/lib/org.ts`). 멤버십이 여러 개면 이 규칙으로 결정, 없으면 **skip + 수동 확인**.

### 1. 고아 목록 산출 (read-only)

**방법 A — SQL LEFT JOIN (어드민/대시보드, 가장 canonical):**
`storage.objects` 는 테이블이므로 `transcript_jobs.storage_key` 와 바로 조인합니다.
```sql
-- audio-uploads 객체 중 transcript_jobs row 가 없는 것 = 고아
select
  o.name                                  as storage_key,
  (storage.foldername(o.name))[1]::uuid   as user_id,
  (o.metadata->>'size')::bigint           as size_bytes,
  o.metadata->>'mimetype'                 as mime_type,
  o.created_at
from storage.objects o
left join public.transcript_jobs t
  on t.storage_key = o.name
where o.bucket_id = 'audio-uploads'
  and t.id is null
  and o.name like '%/%'          -- 폴더 placeholder 제외 (실제 파일만)
order by o.created_at asc;
```
기대: 고아 파일 ≥11건이 파일명 / user_id / 크기 / 생성시각과 함께 출력.

**방법 B — 스크립트 (재사용 가능, 멱등 복구까지 이어짐):**
```bash
# 무플래그 = read-only 산출 (방법 A 와 동일 결과를 JS 로)
node --experimental-strip-types --env-file=.env.local \
  scripts/recover-orphan-transcripts.ts
```

### 2. 파일별 검증

산출된 각 고아에 대해:
- **크기 / mime** — 0바이트·손상·비오디오/비영상 파일은 제외(스크립트가 size=0 을
  경고 표시). 유효 오디오/영상만 복구 대상.
- **user_id(prefix) ↔ org 매핑 확정** — 스크립트가 `organization_members` 로
  org 를 해석. org 미해석(멤버십 0) row 는 `SKIP` 으로 로그하고 복구에서 제외
  → 수동 확인 목록.

### 3. row 생성 (idempotent, 승인 후)

> **멱등 근거**: `transcript_jobs` 스키마(0004)에 `storage_key` **unique 제약이
> 없습니다**. 따라서 스크립트는 insert 직전 `storage_key` 로 select-check 를 해서
> 이미 row 가 있으면 건너뜁니다 → 재실행해도 중복 생성 안 됨. (선택 강화:
> `create unique index concurrently ... on transcript_jobs (storage_key)` 를
> 별도 마이그로 추가하면 DB 레벨로 멱등을 못박을 수 있음 — 이 PR 범위 밖, 후속.)

**보수적 옵션(기본) — 유저 확인 마킹:**
고아별 `transcript_jobs` insert:
```
{ org_id, user_id, storage_key, filename, size_bytes, mime_type,
  provider: 'elevenlabs', model: 'scribe_v2', mode: 'research',
  status: 'error', error_message: 'recovered_orphan' }
```
- `status='error' + error_message='recovered_orphan'` → 파일이 유저 리스트(#546)에
  **"실패(재시도 가능)"** 로 즉시 노출. 유저가 **재시도** 를 누르면 기존
  `/api/transcripts/jobs/[id]/retry` 경로가 signed URL 재발급 + 재-dispatch 를
  수행(ElevenLabs auto-detect, 전 언어 robust) → 정상 전사.
- **왜 `submitting` 이 아니라 `error` 인가** (보수적 해석): row 를 곧바로
  `submitting` 으로 만들면 dispatch 를 별도로 트리거하지 않는 한 **Part 0-2 가
  방금 청소한 stuck `submitting` 을 그대로 재생성**하는 꼴이 됩니다. `error` +
  재시도 경로가 (1) 유저 의사로 provider 크레딧을 쓰고 (2) 검증된 start→dispatch
  파이프라인을 재사용하므로 더 안전·멱등. 공격적 자동 재전사가 필요하면 아래 4번.

**공격적 옵션(승인 시 택1) — 자동 재전사:**
위와 동일 insert 하되 복구 직후 각 row 에 대해 재-dispatch 를 트리거
(§4). 유저 개입 없이 바로 전사가 돌지만 provider 크레딧을 자동 소모하므로
**명시 승인 시에만**. 실행은 `--commit --retranscribe` 로 게이트.

### 4. 재전사 트리거

생성된 row 를 기존 경로로 전사 재개 — **두 방식 중 택1**:
- **(권장, 보수적)** 유저가 리스트(#546)에서 **재시도** 클릭 →
  `POST /api/transcripts/jobs/[id]/retry`. 인증·RLS 소유 확인·signed URL 재발급·
  재-dispatch 가 이미 구현돼 있어 재사용이 가장 robust.
- **(공격적, 어드민 배치)** 어드민이 각 복구 row 에 대해 retry 엔드포인트를
  service-context 로 호출하거나 스크립트 `--retranscribe` 로 dispatch. provider
  한도 내에서 순차 실행. (이 PR 은 문서화까지 — 실제 배치는 승인 후 jarvis/어드민.)

### 5. 검증

- **중복 0** — 스크립트를 재실행하면 "이미 존재 → skip" 로그만, insert 0건.
  또는 SQL: `select storage_key, count(*) from transcript_jobs group by storage_key having count(*) > 1;` → 0행.
- **노출 확인** — 복구 유저의 전사 리스트(#546)에 파일이 나타나는지.
- **재전사 결과** — 재시도한 잡이 `done` 으로 끝나거나, 실패 시 `error_message`
  기록. 손상 파일은 처음부터 제외됐는지(size=0 경고).
- **prod 변경 로그** — 승인·실행 시각·건수를 이 절차 수행자가 기록.

---

## 스크립트 사용법 — `scripts/recover-orphan-transcripts.ts`

기존 `scripts/backfill-recruiting-criteria.ts` 와 동일한 self-contained ops 패턴
(Next 서버 모듈 그래프 미참조, `@supabase/supabase-js` 직접, `service_role`).

```bash
# 필요한 env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# 1) 진단 (무플래그) — read-only. 고아 목록 + org 해석 + size=0 경고. writes 0.
node --experimental-strip-types --env-file=.env.local \
  scripts/recover-orphan-transcripts.ts

# 2) dry-run — --commit 이 만들 insert payload 를 미리보기. writes 0.
node --experimental-strip-types --env-file=.env.local \
  scripts/recover-orphan-transcripts.ts --dry-run

# 3) 복구 (보수적 마킹) — 멱등 insert (status='error', 'recovered_orphan'). writes.
node --experimental-strip-types --env-file=.env.local \
  scripts/recover-orphan-transcripts.ts --commit

# 범위 좁히기: --limit N, --user <user_id>
```

| 플래그 | 동작 | writes |
|---|---|---|
| (없음) | 고아 산출 + org 해석 + 검증 경고 | ❌ |
| `--dry-run` | 위 + insert payload 미리보기 | ❌ |
| `--commit` | 멱등 row 생성 (보수적 마킹) | ✅ (승인 후 jarvis/어드민만) |
| `--limit N` | 최대 N건만 처리 | — |
| `--user <id>` | 특정 user_id 의 고아만 | — |

> ⚠️ `--commit` 은 prod write 이므로 **이 PR 범위 밖**(문서·dry-run 검증까지).
> 실제 실행은 사용자 승인 후 **jarvis/어드민**이 `service_role` 로.

---

## 관계 / 재발 방지

- **#549 (row-first 핸드오프)** — per-file row 를 업로드 전에 먼저 생성 →
  이후 "조용히 사라짐" 근본 제거. **이 런북은 그 이전의 유실을 일회성 복구**.
- **#551 (클라 타임아웃 fail-open)** / **#552 (백엔드 유령 슬롯 sweep/TTL)** —
  Part 0 유령 슬롯 재발 방지. 이 런북은 **기존 적체 청소**.
- **#546 / #548** — 멈춘·실패 잡 표면화 + 재시도/삭제. Part 0-2·Part 1 의
  `error` 마킹이 이 UI 로 유저에게 노출됨.
- prod 데이터 op → PROJECT.md §7.5(마이그 수동 적용) / 승인 게이트 원칙 준수.
