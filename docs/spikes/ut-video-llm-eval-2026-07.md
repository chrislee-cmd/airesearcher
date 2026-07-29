# 스파이크 — UT 영상 인사이트: TwelveLabs 4단 vs 네이티브 영상 LLM (2026-07)

- **카드**: 583 · **성격**: 판단 근거용 스파이크(프로덕션 무변경) · **작성**: 2026-07-29
- **러너**: [`scripts/spikes/ut-video-eval.mjs`](../../scripts/spikes/ut-video-eval.mjs)
- **현행 파이프라인 SSOT**: [`src/lib/ut/insight-clips.ts`](../../src/lib/ut/insight-clips.ts) · [`src/lib/ut/insight-llm.ts`](../../src/lib/ut/insight-llm.ts)

---

## 결론 (한 줄)

**대체 가치 있음 — 강함 (단, 후보 모델 재지정 필요).** UT 순간탐색 + 인사이트 합성은
**네이티브 Gemini 영상-이해 Flash(`gemini-3.6-flash` / `gemini-2.5-flash`)의 단일
`generateContent` 호출**로 대체 가능하며, 이 경우 4단 상태머신 · 이중 외부의존
(TwelveLabs + ffmpeg) · 504/resumable 복잡도가 사라지고 세션당 비용이 **약 3~40×
절감**된다. **단 스펙이 지목한 "Gemini Omni Flash" 는 대상이 아니다 — 문서·라이브
API 실확인 결과 이는 영상 *생성*(text/image→video) 모델이며 영상 *이해* 용도가
아니다.** 최종 품질(타임코드 정확도·한국어 발화 이해)의 수치 확정은 팀 자체 녹화
샘플에 러너를 실행해 채워야 한다(§실측 상태 참조).

---

## ⚠ 후보 모델 정정 (스펙 전제 vs 문서 실확인)

스펙은 "Gemini Omni Flash(네이티브 영상 LLM)" 를 TwelveLabs 대체 후보로 지목했다.
스펙의 지시("프리뷰라 이름·제약 유동 — 문서 실확인 필수, 추측 금지")에 따라 Google
공식 문서와 라이브 API 를 확인한 결과:

| 항목 | 실확인 결과 |
|---|---|
| `gemini-omni-flash-preview` | **영상 *생성* 모델** (text/image → video, 10초 클립, 오디오 동반 생성). 공개 프리뷰(2026-06-30). |
| 영상 *입력* | *편집* 용도만 지원. "3초 초과 영상 레퍼런스는 API 스키마상 받지만 모델이 정상 처리하지 못함." EEA/스위스/영국은 편집 업로드 불가. |
| UT 분석 적합성 | **부적합.** 5~20분 스크린레코딩을 분석해 타임코드+인사이트를 뽑는 작업은 이 모델의 설계 목적이 아님. |
| 라이브 확인 | 이 키의 `models.list` 에 존재하나 `createCachedContent`/`batchGenerateContent` 미지원 — 이해 모델(2.5/3.x flash)과 능력셋이 다름(생성 모델 특성). |

**→ 올바른 대체 후보는 표준 Gemini 영상-이해 Flash 계열이다.** 이 계열이 정확히
현행 파이프라인이 필요로 하는 것(긴 영상 입력, MM:SS 타임코드, 화면+음성 동시
이해)을 제공한다. 이하 평가는 이 계열을 대상으로 한다.

출처: [ai.google.dev/docs/omni](https://ai.google.dev/gemini-api/docs/omni) ·
[Google Cloud 블로그](https://cloud.google.com/blog/products/ai-machine-learning/nano-banana-2-lite-and-gemini-omni-flash-available)

---

## 평가 대상

| 역할 | 모델 | 근거 |
|---|---|---|
| **후보 (primary)** | `gemini-3.6-flash` (GA) | 이 키에서 가용한 최신 GA Flash. 영상 이해 + MM:SS 타임코드. |
| **후보 (안정 비교군)** | `gemini-2.5-flash` (GA) | 안정판, 최저 요율($0.30/1M in). 프리뷰 불안정 대비 폴백. |
| **베이스라인** | 현행 TwelveLabs 4단 | Marengo(순간탐색) + Pegasus(분석) + ffmpeg(클립) + 인덱싱. |

라이브 `--check` 로 확인된 이 키의 가용 이해 모델(발췌): `gemini-2.5-flash`,
`gemini-2.5-pro`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`,
`gemini-3.5-flash`, **`gemini-3.6-flash`**. (Omni Flash 도 존재하나 위 §정정대로 제외.)

---

## 비교 표

수치 중 **[실측]** 은 팀 녹화 샘플에 러너 실행 시 `usageMetadata` 등으로 채워짐,
**[투영]** 은 공개 요율·문서 스펙 기반 산정, **[구조]** 는 아키텍처 사실.

### ① 순간(모먼트) 탐지 품질 — 타임코드 정확도(±초), 놓침/과잉

| | TwelveLabs 4단 | Gemini Flash 단일호출 |
|---|---|---|
| 타임코드 반환 | Marengo 검색 결과(초) → turn 경계 스냅 | **MM:SS 네이티브 지원** [구조] (docs: `01:15` 형식) |
| 정확도(±초) | [실측 대기] — turn 스냅으로 발화경계엔 정확 | [실측 대기] — 러너 3~5개 육안 스팟체크 |
| 놓침/과잉 | [실측 대기] | [실측 대기] |
| 근거 소스 | 전사(LLM plan) + Marengo(영상) 보조 | 화면+음성 직접 관찰(프레임+오디오) [구조] |

> 구조적 차이: 현행은 **전사 기반으로 순간을 계획**하고 Marengo 는 시간창만 보정
> (`insight-llm.ts` planMoments 주석). Gemini 는 화면 시각정보를 1차 근거로 씀 →
> 발화 없는 시각적 마찰(무음 클릭 방황 등) 포착에 이론상 유리. [실측 대기]

### ② 인사이트 분석 품질 (friction·감정·인용 정확)

| | TwelveLabs 4단 | Gemini Flash 단일호출 |
|---|---|---|
| 산출 스키마 | summary/quote/friction/emotion/severity + 세션 리포트 | **동일 스키마로 요청**(러너가 `insight-llm.ts` 참조) [구조] |
| 인용 정확도 | Pegasus 실패 시 텍스트-LLM 폴백 | [실측 대기] |
| 근거 | Pegasus(영상) or 구간 전사 | 영상+오디오 통합 [구조] |

### ③ 한국어 발화 이해 (필수)

| | TwelveLabs 4단 | Gemini Flash 단일호출 |
|---|---|---|
| 경로 | ElevenLabs 전사(별도) → LLM | 영상 내 오디오 직접(오디오 32 tok/s) [구조] |
| 품질 | [실측 대기] | [실측 대기] — 한국어 샘플 1개 필수(스펙) |

### ④ 처리 시간 (분당)

| | TwelveLabs 4단 | Gemini Flash 단일호출 |
|---|---|---|
| 단계 | 인덱싱(폴링)→검색→클립(클립당 1 POST)→분석(클립당 1 POST)→리포트 | 업로드 1회 + `generateContent` 1회 [구조] |
| 벽시계 | 인덱싱 트랜스코딩 대기 포함, 다중 라운드트립 | 업로드 + 1 추론 [실측 대기 — 러너 `elapsedSec`] |

### ⑤ 비용 / 세션 (요율 실확인, 20분 세션 기준)

**투영 근거**: 영상 토큰 ≈ 기본 300 tok/s(프레임) + 오디오 32 tok/s, 저해상도 100 tok/s.
20분 = 1200초 → 기본 영상 360,000 tok + 오디오 38,400 tok / 저해상 120,000 + 38,400.

| 경로 | 세션당 비용(20분) | 산정 |
|---|---|---|
| **TwelveLabs** | **≈ $1.3 ~ $3.4** [투영] | 인덱싱 $0.042/분 × 20 = **$0.84** + Pegasus analyze $0.021/분 × (1~6 호출) + 출력 토큰. |
| **Gemini 2.5 Flash** (기본) | **≈ $0.15** [투영] | 360k×$0.30 + 38.4k×$1.00(audio) /1M ≈ $0.146 + 출력 소액. |
| **Gemini 2.5 Flash** (저해상) | **≈ $0.07** [투영] | 120k×$0.30 + audio ≈ $0.074. |
| **Gemini 3.6/3.5 Flash** (기본) | **≈ $0.60** [투영] | 398k×$1.50 /1M ≈ $0.598. |
| **Gemini 3.6/3.5 Flash** (저해상) | **≈ $0.24** [투영] | 158k×$1.50 /1M ≈ $0.238. |

→ 안정판 2.5 Flash 는 TwelveLabs 대비 **약 10~40× 저렴**, 최신 3.6 Flash 도 **3~10×
저렴**. (전사(ElevenLabs)는 두 경로 공통이라 비교에서 제외.) [실측 시 러너의
`cost`/`usageMetadata` 로 정밀화.]

출처: [Gemini 요금](https://ai.google.dev/gemini-api/docs/pricing) ·
[영상 이해 토큰](https://ai.google.dev/gemini-api/docs/video-understanding) ·
[TwelveLabs 요금](https://www.twelvelabs.io/pricing)

### ⑥ 파이프라인 단순화 (단계 수 · 실패 지점)

| | TwelveLabs 4단 | Gemini Flash |
|---|---|---|
| 단계 수 | **5 상태**(indexing→searching→clipping→analyzing→reporting) | **2**(업로드 → 1 호출) [구조] |
| 외부 의존 | TwelveLabs + ffmpeg(클립) + Anthropic(plan/폴백) | Gemini 1개 [구조] |
| 실패 지점 | 인덱싱 실패 · Marengo 쿼터 · ffmpeg cut_failed · Pegasus 실패 · 504/resumable | 업로드 실패 · 추론 실패 [구조] |
| 코드량 | `insight-clips.ts` 547줄 상태머신 | 단일 호출 + 스키마 파싱 |

---

## 제약 실측 (우리 세션이 들어가는가)

| 제약 | Gemini 영상 이해 | 우리 세션(수십 분 스크린레코딩) |
|---|---|---|
| 최대 영상 길이 | 1M 컨텍스트: 기본 해상도 **1시간**, 저해상도 **3시간** | ✅ 5~20분 여유 통과 |
| 업로드 한도 | File API **20GB(유료)/2GB(무료)**, inline <100MB(<1분) | ✅ File API 경로(러너가 리줌어블 업로드) |
| 타임코드 형식 | **MM:SS** 네이티브(`01:15`) | ✅ 현행 mmss 와 동형 |
| 미디어 해상도 | `media_resolution` low/default — 토큰 1/3, 길이 3× | 긴 세션은 `--resolution low` 권장 |

출처: [영상 이해 문서](https://ai.google.dev/gemini-api/docs/video-understanding).

---

## 실측 상태 (정직성 명시)

이 스파이크는 **워커 세션(코드 전용)** 에서 수행되었다. 제약상 여기서 **실 A/B 실행은
수행하지 못했다**:

- PII 하드 규칙(프로덕션 사용자 녹음 금지 → 팀 자체 녹화만)에 따라 이 워크트리에
  샘플 UT 영상이 없음. 로컬 dev 서버/브라우저 사용 금지(워커 규칙).
- 따라서 표의 [실측 대기] 칸은 **러너를 팀 녹화 샘플에 실행**해 채워야 한다.

**실측된 것**(라이브 API 호출):
- ✅ 모델 가용성 — `--check` 로 이 키에서 `gemini-2.5-flash`/`gemini-3.6-flash` 등
  이해 모델 실재 확인. Omni Flash 능력셋 차이 확인.
- ✅ 러너 동작 — `--check` 정상 실행(비용 0).
- ✅ 요금·토큰·길이 제약 — Google/TwelveLabs 공식 문서 실확인(출처 링크).

**실측 절차(스펙 §방법 그대로)**:
```bash
# 팀 자체 녹화(화면+음성, 한국어 1개 이상, 5~20분) 준비 후:
node scripts/spikes/ut-video-eval.mjs \
  --video ./team-session-ko.mp4 \
  --goal "결제 흐름에서 막히는 지점 찾기" \
  --locale ko --models gemini-3.6-flash,gemini-2.5-flash --resolution low
```
→ 각 모델 모먼트/리포트 나란히 출력 + `usageMetadata` 기반 실비용. 반환 타임코드로
실제 장면 육안 스팟체크(영상당 3~5개) 후 위 ①③ 칸 기입. 동일 영상의 현행
TwelveLabs `insight_summary`/`ut_clips` 와 나란히 놓고 ②④ 비교.

---

## 후속 권고 (채택 시 마이그 범위 초안)

**권고: 채택 진행 — 단, 팀 샘플 실측(위 절차)으로 품질 게이트 통과가 선행 조건.**
품질이 동등 이상이면 아키텍처·비용 이득이 크다.

채택 시 마이그 범위(한 단락 초안):
1. **의존성**: `@ai-sdk/google` 추가(현재 미설치) 또는 러너처럼 REST 직접 호출.
   env 에 `GEMINI_API_KEY`(이미 존재). 2. **`src/lib/ut/`**: `insight-clips.ts`
   상태머신을 `idle → uploading → analyzing → done` 2~3단으로 축소, TwelveLabs
   (`createAsset`/`createIndexedAsset`/`searchIndex`/`analyzeVideo`) + `clip-video.ts`
   (ffmpeg) 의존 제거. `insight-llm.ts` 의 planMoments/synthesizeReport 를 단일
   Gemini 호출로 통합(스키마는 그대로 유지 — DB `ut_clips.insight`/`insight_summary`
   shape 불변이면 프론트 무변경). 3. **클립 미디어**: 순간탐색이 타임코드만 필요하면
   ffmpeg 클립 컷은 선택 기능으로 남기거나 range-cut 만 유지. 4. **DB**: `ut_sessions`
   의 `tl_*` 컬럼은 유예 후 제거(destructive → 수동 마이그, §7.5). 5. **점진 전환**:
   피처 플래그로 Gemini 경로 A/B 후 기본값 스위치. 프리뷰 대신 GA(`gemini-2.5-flash`
   최저비용 or `gemini-3.6-flash` 최신)로 시작 권장.

리스크: 긴 영상은 저해상도 필요(시각 디테일 저하 가능) → ①품질 실측으로 확인.
프리뷰 모델 의존 금지(GA 로 시작).
