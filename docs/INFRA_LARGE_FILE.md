# 대용량 파일 처리 인프라 한도 런북

> **목적.** 대용량 파일(예: 1GB 영상/오디오)을 **안정적으로 전사**하려면
> 각 인프라 레이어에서 무엇을 챙겨야 하는지 — 특히 **plan upgrade 시 확인할 항목** —
> 를 한 문서로 실측·정리한다. 코드-side 사실은 이 repo 에서 실측해 채웠고,
> 플랜/대시보드-side 는 **☐ (Chris 확인)** 체크박스로 남긴다.
>
> **작성:** 2026-07-10 · 코드 변경 없음(문서 전용) · 관련 카드 #547
> **원칙:** 임의 크기 임계 결론을 강요하지 않는다. 아래 표의 "대용량 필요값/판단"
> 은 코드 실측 + 플랜 확인 후 Chris 가 결정할 근거일 뿐, 확정 임계값이 아니다.

---

## 🚨 0. 최우선 액션 — Deepgram Auto-reload = ON

현재 **Deepgram = Pay As You Go(On Demand)**, **Auto-reload = OFF**.

- **위험:** PAYG 크레딧이 소진되면 Deepgram 이 전사 요청을 거부하고,
  이 앱은 `deepgram_<status>` 에러로 job 을 `error` 처리한다 — 하지만
  크레딧 소진은 **사전 경고 없이 발생**하므로 사용자 입장에선 전사가
  "조용히 실패"하는 것으로 보인다(silent failure).
- **영어(en/en-GB) 전사가 전부 Deepgram** 이므로(§3 provider 매핑), 크레딧
  소진 시 영어 전사 파이프라인 전체가 멈춘다.
- **액션:** Deepgram 콘솔 → Billing → **Auto-reload 를 ON** 으로 전환(임계
  잔액 도달 시 자동 충전). 이 한도 문서의 다른 어떤 항목보다 먼저 처리 권장.

---

## 1. 파이프라인 = 4 레이어 (각각 독립 한도)

```
브라우저
  │  ① TUS resumable 업로드 (6MB 청크, 직접)
  ▼
Supabase Storage  (bucket: audio-uploads, private)
  │  ② 메타데이터만 POST (storage_key/filename/size) — 파일은 함수 미통과
  ▼
Vercel 함수  (/api/transcripts/start)
  │  ③ 6h signed URL 발급 → provider 가 URL 로 파일 fetch (= Supabase egress)
  ▼
provider  (Deepgram nova-3 / ElevenLabs Scribe v2)
  │  webhook(Deepgram) / poll(ElevenLabs) 로 결과 회수
  ▼
DB  (transcript_jobs)
```

**핵심:** 파일 바이트는 **브라우저 → Supabase Storage → provider** 로만 흐른다.
Vercel 함수에는 **메타데이터(JSON)만** 통과하므로 함수 body 한도(4.5MB)에
파일이 걸리지 않는다(§2). 따라서 대용량 병목은 **provider → Supabase(egress)
→ Vercel(함수 시간) → 코드(안정화)** 순으로 본다.

**우선순위:** ③ provider → ① Supabase → ② Vercel → ④ 아키텍처(코드).

---

## 2. 레이어별 한도 표

각 표: **[한도 항목 | 코드 실측값 | 현재 플랜값(☐ Chris 확인) | 대용량 판단 | 액션]**

### ③ provider (Deepgram / ElevenLabs) — 대용량 **1순위 병목**

전사 자체가 오래 걸리고, provider 플랜의 파일 크기·길이·동시성 상한이 가장
먼저 걸린다. 현재: **Deepgram = PAYG On Demand**, **ElevenLabs = Starter(저티어)**.

| 한도 항목 | 코드 실측값 | 현재 플랜값 (☐ Chris) | 대용량 판단 | 액션 |
|---|---|---|---|---|
| provider 매핑 | 영어(en/en-GB) → **Deepgram nova-3**, 그 외 전부 + 자동감지 → **ElevenLabs Scribe v2** (`languages.ts`) | — | 한국어 인터뷰 = ElevenLabs 경로 | — |
| 요청당 **최대 파일 크기** | 앱은 상한 없음 — provider 로 signed URL 만 넘김 | ☐ Deepgram(PAYG) 파일 크기 상한 확인 · ☐ ElevenLabs(Starter) STT 파일 크기 상한 확인 | 1GB 파일이 두 provider 상한 안인지 | 상한 초과 시 chunking(#548) 필요 |
| 요청당 **최대 오디오 길이** | 앱은 상한 없음 | ☐ Deepgram async 최대 길이 · ☐ ElevenLabs Scribe 최대 길이 확인 | 장시간(예: 3h+) 녹음이 상한 안인지 | — |
| **Concurrency / rate limit** | 앱은 job 당 1 요청, 병렬 상한 없음(사용자가 여러 파일 동시 업로드 가능) | ☐ Deepgram(PAYG) 동시 요청 상한 · ☐ **ElevenLabs Starter 동시성 상한**(저티어라 낮을 가능성 — 확인 필수) | 동시 업로드 다수 시 ElevenLabs 가 429 로 먼저 막힐 수 있음 | Starter 상한 낮으면 플랜 상향 또는 큐잉 |
| 크레딧 소진 처리 | 소진 시 `error` 로 job 마감(사용자엔 무음 실패) | ☐ **Deepgram Auto-reload = ON**(§0) · ☐ ElevenLabs 크레딧 잔량 알림 | silent failure 방지 | §0 Auto-reload ON |
| async 콜백 안정성 | Deepgram=webhook(`callback`), ElevenLabs=**poll**(webhook 미배달 확인 → `poll/route.ts`로 대체) | — | ElevenLabs webhook 신뢰 불가 — poll 유지 | — |
| signed URL TTL | **6h**(`createSignedUrl(key, 60*60*6)`, start route) | — | provider 가 6h 안에 fetch 시작해야 — 초장시간 대기열 시 만료 위험 | 대기 폭주 시 TTL 상향 검토 |

### ① Supabase (Storage) — 2순위: 용량 + **egress**

| 한도 항목 | 코드 실측값 | 현재 플랜값 (☐ Chris) | 대용량 판단 | 액션 |
|---|---|---|---|---|
| 버킷 **파일당 크기 상한** | `audio-uploads` `file_size_limit = 5368709120` (**5 GiB**), private (`0004_transcript_jobs.sql`) | — (코드 SSOT) | 1GB ≪ 5GiB → 버킷 자체는 여유 | — |
| **프로젝트 전역 Upload 상한** | 코드 밖 — 버킷값과 **별개로 더 낮게** 걸릴 수 있음 | ☐ Supabase Dashboard → Storage → Settings → **Global file upload limit** 확인(≥ 버킷 5GiB 인지) | 전역값이 5GiB 보다 낮으면 그게 실질 상한 | 낮으면 상향 |
| Storage **총 용량** | — | ☐ Pro plan 100GB 포함(초과분 종량) — 현재 사용량 확인 | 대용량 누적 시 용량 소진 | 보관 정책(오래된 원본 삭제) 검토 |
| **Egress 대역폭** ⚠️ | provider 가 signed URL 로 파일을 **fetch** = **egress 발생**. 1GB 전사 = **최소 1GB egress** (+ 원본 다운로드/미리보기마다 추가) | ☐ Pro plan 250GB 포함 egress — 현재 사용량 확인 | 대용량·다건이면 egress 가 가장 빨리 소진되는 종량 항목 | 사용량 모니터링 · 초과 종량 요금 인지 |
| 업로드 방식 | 브라우저 직접 **TUS resumable**, 6MB 청크, 지수 백오프 재시도 + 이어받기(`resumable-upload.ts`, `quotes-card-body.tsx:412`). Bearer 세션 토큰 + RLS(`auth.uid()` prefix) | — | 끊겨도 마지막 청크부터 재개 — 대용량에 적합 | — |

### ② Vercel (앱 호스트) — 3순위: 함수 시간

| 한도 항목 | 코드 실측값 | 현재 플랜값 (☐ Chris) | 대용량 판단 | 액션 |
|---|---|---|---|---|
| 함수 **request body 4.5MB** | 파일은 함수 미통과(브라우저→Storage 직접, §1). `/api/transcripts/start` 는 JSON 메타(storage_key/filename/size)만 받음 | — | **파일 크기와 무관** — 대용량이어도 함수 body 안 걸림 | 업로드가 함수 body 를 타지 않는 구조 유지(직접 업로드 회귀 금지) |
| 함수 **maxDuration** | start=미지정(플랫폼 기본) · webhook/poll/webhook-elevenlabs=**200s** (`export const maxDuration=200`) | ☐ Pro plan 함수 실행 상한(현행 플랫폼 기본 300s / Fluid) 확인 | provider 가 async 라 함수는 dispatch·결과 회수만 — 전사 시간 자체는 함수 밖 | 200s 안에 dispatch/poll 이 완주하는지 유지 |
| sync 전사 함정(이력) | 90분 한국어 인터뷰가 **sync 모드에서 Vercel 60s 타임아웃** → async(`webhook=true`/poll)로 전환됨(start route 주석) | — | 대용량은 반드시 async 경로 유지 | sync 회귀 금지 |
| 대역폭 / Fluid Compute | — | ☐ Pro plan 대역폭·Fluid Compute 설정 확인 | 함수는 메타·결과만 오가므로 대역폭 영향 작음 | — |

### ④ 아키텍처 (플랜 무관 — 코드 안정화, cross-ref #548)

> **플랜을 올려도 코드 안정화는 별도로 필요하다.** 아래는 플랜 티어와 무관하게
> 코드에서 다뤄야 하는 항목이며, **#548(핸드오프 안정화)** 로 이관해 추적한다.

| 항목 | 현재 상태 | 이관 |
|---|---|---|
| 핸드오프 재시도 / idempotency | dispatch 실패 시 job=error 로 마감, 자동 재시도 없음 | #548 |
| reconciliation cron | `transcribing` 에서 멈춘 job 자동 회수 없음(사용자 poll 의존) | #548 / #546(stuck 표면화) |
| 대용량 chunking | provider 파일/길이 상한 초과 시 분할 없음 | #548 |
| 모니터링 | provider 실패·egress 급증 Sentry 알림 정합 | #548 |

---

## 3. 요약 — plan upgrade 체크리스트 (우선순위 순)

1. **🚨 Deepgram Auto-reload = ON** (§0) — silent failure 방지, 즉시.
2. **③ provider (1순위 병목)**
   - ☐ ElevenLabs **Starter 동시성 상한** 확인 — 저티어라 다건 동시 업로드 시
     가장 먼저 막힘. 낮으면 플랜 상향 또는 큐잉.
   - ☐ Deepgram / ElevenLabs **요청당 최대 파일 크기·오디오 길이** 확인.
3. **① Supabase (2순위)**
   - ☐ **전역 Upload 상한**이 버킷 5GiB 이상인지(더 낮으면 그게 실질 상한).
   - ☐ **Egress 사용량** — provider signed-URL fetch 가 egress 를 태움
     (1GB 전사 = 최소 1GB egress). Pro 250GB 포함, 초과 종량.
4. **② Vercel (3순위)**
   - ☐ 함수 maxDuration(플랫폼 기본 300s/Fluid) 확인 — 파일 크기와 무관,
     async dispatch/poll 만 하므로 여유. 직접 업로드 구조 유지.
5. **④ 아키텍처** — 플랜과 무관하게 **#548 코드 안정화 별도 필요**.

> **결론:** 인프라 티어(Supabase Pro / Vercel Pro)는 대용량에 적정하며 추가
> 불필요. 대용량 안정성의 실질 관문은 **provider(특히 ElevenLabs Starter
> 동시성) + Supabase egress + #548 코드 안정화**다. 확정 크기 임계값은 위
> ☐ 항목을 Chris 가 대시보드에서 실측한 뒤 판단한다.

---

## 관련 문서

- **#548** 핸드오프 안정화(코드) — 재시도/idempotency/reconciliation/chunking.
- **#546** stuck 잡 표면화 — `transcribing` 정지 job UI 노출.
- `docs/AUTH_SETUP.md` 등과 동형의 Chris-action 런북.
- 코드 SSOT: `supabase/migrations/0004_transcript_jobs.sql`,
  `src/app/api/transcripts/start/route.ts`,
  `src/lib/transcripts/{languages,resumable-upload}.ts`,
  `src/app/api/transcripts/jobs/[id]/poll/route.ts`.
</content>
</invoke>
