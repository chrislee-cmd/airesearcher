# 스파이크 — 전사록 엔진 A/B 평가 (2026-07)

> **card 582 · pr-stt-engine-eval-spike · 보고서. 프로덕션 무변경.**
> 재실행 스크립트: [`scripts/spikes/stt-eval.ts`](../../scripts/spikes/stt-eval.ts)
> 작성 2026-07-29. 요금·벤치마크는 아래 §출처 의 라이브 페이지 실확인값.

---

## 결론 (한 줄)

**교체하지 말 것. 현행 엔진(EN=Deepgram Nova-3 · 그 외=ElevenLabs Scribe v2) 유지.**
OpenAI `gpt-transcribe`/`gpt-4o-transcribe-diarize` 는 한국어 정확도에서 **우위가 없고**(공개 FLEURS 기준 Scribe 와 동급~약간 열세), 비-영어 대다수 경로에서 **오히려 더 비싸며**(Scribe $0.22/hr vs OpenAI ~$0.36/hr), **25 MB 파일 상한**이 제품의 핵심 유스케이스(90분 한국어 인터뷰)를 그대로 깨뜨린다. 유일한 매력(키워드 주입으로 post-pass 부담 절감)은 **화자분리와 상호배타**라 단일 패스로 대체가 불가능하다. → 후속 티켓(전면 교체) 불필요. 좁은 예외 니치(영어·<25 MB·용어 밀집 클립)만 향후 재검토 가치가 있고, 그마저 지금은 우선순위 낮음.

---

## 평가 대상

| 엔진 | 역할 | 현재 사용처 |
|---|---|---|
| **Deepgram Nova-3** | 영어 SOTA 파일 전사 (화자분리) | 현행 EN 경로 (`en`, `en-GB`) — `dispatchDeepgram` |
| **ElevenLabs Scribe v2** | 그 외 전 언어 (ko/ja/zh/…, `multi`) 화자분리 전사 | 현행 non-EN 경로 — `dispatchElevenLabs` / `scribeTranscribe` |
| **OpenAI `gpt-transcribe`** | 신규 파일 전사 — `prompt`/`keywords`/`languages` 지원, 언어 자동감지 | 후보 (배치 전사엔 미사용, 현재 OpenAI 는 실시간 통역 전용) |
| **OpenAI `gpt-4o-transcribe-diarize`** | 화자분리 라벨 (`diarized_json`), `known_speaker_references[]` | 후보 |

현행 라우팅 SSOT: [`src/lib/transcripts/languages.ts`](../../src/lib/transcripts/languages.ts) — 영어만 Deepgram, 나머지 전부 Scribe. 그 파일 주석에 이미 기록된 내부 실측:

> *"[Scribe v2] beat Deepgram nova-2 by ~2.15× word recall on a 90-min Korean interview (A1 experiment, 2026-06-16)."*

즉 **한국어 챔피언은 이미 Scribe** 이고, 이번 질문은 "OpenAI 가 Scribe 를 이기느냐" 이다.

---

## 방법

1. 샘플 5~10개(한국어 인터뷰 위주 + 영어 1~2, 2인 대화 포함, 각 3~10분)를 [`stt-eval.ts`](../../scripts/spikes/stt-eval.ts) 로 4~5개 엔진에 실행. OpenAI 는 keywords **유/무** 2조건으로 분리 실행(용어 주입 효과 격리).
2. 정답 전사가 없으므로 **Claude 심판**(동일 오디오의 두 전사를 나란히 주고 divergence 항목 나열 — 판정 프롬프트는 스크립트 상단 `JUDGE_SYSTEM` 상수이자 이 보고서 §심판 프롬프트) + 육안 스팟체크 병행.
3. 비용은 각 제공사 요금 페이지 실확인(§출처), 추정 금지.

### 샘플 실측(육안·심판)에 대한 정직한 고지

이 스파이크의 정량 비교 **가능 축**(요금 실측 · 공개 WER 벤치마크 · 코드베이스 내 A1 한국어 recall 실측 · 문서화된 하드 리밋)은 아래 §비용/§정확도/§한계에서 결론에 충분한 근거를 제공한다. 반면 **자체 오디오에 대한 케이스별 오류 발췌(3~5개)** 는 이 워커 환경에서 생성하지 **않았다** — PII 하드 규칙상 프로덕션 녹음 사용 금지이고, 라이선스 확인된 한국어 2인 인터뷰 샘플을 헤드리스로 안전하게 소싱하는 것이 비현실적이기 때문이다(스펙도 샘플을 로컬 경로 인자로만 받도록 규정 — 운영자가 제공). 측정값을 **날조하지 않기 위해**, 케이스 발췌는 `stt-eval.ts` 를 운영자의 라이선스-세이프 샘플에 돌리면 `summary.md` 에 자동 산출되도록 구조화했다(§케이스 발췌 템플릿). **결론 자체는 실측 가능한 축만으로 이미 결정적**이며, 자체 런은 그 결론의 확인 절차다.

---

## §비용 (분당·시간당, USD — 실확인)

| 엔진 | 단가 | 시간당 | 근거 |
|---|---|---|---|
| **ElevenLabs Scribe v2 (batch)** | **$0.00367/min** | **$0.22/hr** | PAYG, 2026-06-29 인하 후. |
| **Deepgram Nova-3 (monolingual, pre-recorded)** | **$0.0077/min** | $0.462/hr | PAYG. multilingual 은 $0.0092/min ($0.552/hr). |
| **OpenAI `gpt-transcribe`** | **~$0.006/min** | ~$0.36/hr | 토큰 과금 $2.50/1M in · $10/1M out. per-minute 은 OpenAI 공표 추정치(gpt-4o-transcribe 계열). |
| **OpenAI `gpt-4o-transcribe-diarize`** | ~$0.006/min+ | ~$0.36/hr+ | 동일 토큰 기준. `diarized_json` 출력 토큰이 실효 단가를 소폭 상향. |

**해석:**
- **비-영어 대다수 경로**(제품 사용량의 절대다수 — 한국어): 현행 Scribe **$0.22/hr** 가 OpenAI **~$0.36/hr** 보다 **~1.6× 저렴**. 교체 시 비용 상승.
- **영어 경로**: Deepgram $0.462/hr 가 OpenAI ~$0.36/hr 보다 비쌈 → 영어 **한정** 으로는 OpenAI 가 비용 우위. 단 영어는 제품 사용 비중이 낮고, Deepgram 을 쓰는 이유는 가격이 아니라 영어 정확도.

---

## §정확도 (한국어 = 결정 축)

정답 라벨이 있는 공개 벤치마크(FLEURS) 기준:

| 엔진 | 한국어 WER (FLEURS) | 비고 |
|---|---|---|
| **ElevenLabs Scribe** | **~3.1%** | 공개 벤치마크 최상위권. 내부 A1 에서도 한국어 인터뷰 recall 챔피언. |
| **OpenAI gpt-4o-transcribe** | Scribe 대비 1~2pp 내 근접(대체로 근소 열세/동급) | "close behind" — 상위 5개 시스템이 1~2pp 밴드 안에 밀집. |
| **Deepgram Nova-3** | 상위 밴드(깨끗한 낭독 음성 기준) | 단 **실제 한국어 인터뷰 음성**에선 nova-2 대비 A1 에서 Scribe 에 2.15× recall 열세 — 정제 벤치마크와 현장 성능 괴리. |

**핵심:** OpenAI 는 한국어에서 Scribe 를 **이기지 못한다**(기껏해야 동급). 교체의 1차 동기인 "한국어 정확도 향상"이 **성립하지 않는다.** 벤치마크는 낭독 음성이라 실제 인터뷰(중첩 발화·잡음·조사 결합)에서의 우위는 더 좁아지며, 그 도메인에서의 내부 실측(A1)은 이미 Scribe 손을 들어줬다.

> `gpt-transcribe`(신모델)의 한국어 WER 은 gpt-4o-transcribe 계열과 동일 아키텍처군이라 유의미한 도약을 기대하기 어렵다. 확정하려면 `stt-eval.ts --lang ko --judge` 로 스팟체크(스크립트가 Scribe vs gpt-transcribe divergence 를 심판으로 뽑아줌).

---

## §화자분리

| 엔진 | 화자분리 방식 | 제약 |
|---|---|---|
| **Scribe v2** | word-level `speaker_id` + `num_speakers` hint (현행 non-EN) | 90분 async 파일 처리 OK. |
| **Deepgram Nova-3** | `diarize=true` utterance 라벨 (현행 EN) | async 파일 OK. |
| **gpt-4o-transcribe-diarize** | `diarized_json` 세그먼트 + `known_speaker_references[]`(최대 4개 참조 오디오로 알려진 화자 매핑) | **`prompt`/`keywords` 미지원** · 16k 컨텍스트/2k 출력 토큰 · **25 MB 파일 상한**. |

`known_speaker_references[]`(참조 오디오로 화자를 이름에 고정)는 현행 엔진에 **없는 유일한 신기능**이다. 다만 우리 제품은 인터뷰 참가자를 사전에 오디오로 등록하는 플로우가 없어(익명 리서치 세션) 실효 가치가 낮다.

---

## §keywords 주입 → post-pass 영향 분석 (스펙 요구 항목)

현행 파이프라인(전사 후처리 SSOT):
`STT(diarized) → cleanup(Haiku, disfluency 제거) → term-normalize(Haiku, 철자 변이 클러스터링) → number-normalize(Haiku, 숫자 정규화)`
([`cleanup.ts`](../../src/lib/transcripts/cleanup.ts) · [`term-normalize.ts`](../../src/lib/transcripts/term-normalize.ts) · [`number-normalize.ts`](../../src/lib/transcripts/number-normalize.ts))

`gpt-transcribe` 는 `prompt`/`keywords`/`languages` 로 **STT 단계에서** 도메인 용어를 편향시킬 수 있다 → 이론상 `term-normalize` 가 잡던 고유명사/전문용어 오류를 상류에서 줄여, post-pass 부담을 낮출 여지가 있다. **이것이 OpenAI 채택의 유일한 실질 매력.**

그러나 **채택을 막는 구조적 벽:**

1. **키워드와 화자분리가 상호배타.** `gpt-transcribe`(키워드 O) 는 화자분리를 **안 한다**. `gpt-4o-transcribe-diarize`(화자분리 O) 는 **키워드를 안 받는다**. 우리 전사록은 **화자분리가 필수**(인터뷰 turn 구조)라, 키워드 이득을 얻으려면 ① 화자분리를 포기하거나 ② 두 번 호출(키워드 전사 + 별도 diarize 후 정렬)해야 함 → STT 비용 2배 + 세그먼트 정렬 신규 인프라.
2. **post-pass 는 이미 견고.** `term-normalize` 는 문서 내 변이가 ≥2회 등장·길이 드리프트 5% 캡·atomic 치환 가드로 안전하게 동작(교체해도 이 단계는 유지 필요 — cleanup/number 는 STT 무관). STT 키워드 편향의 한계 이득이 Haiku post-pass 를 없앨 만큼 크지 않다.
3. **키워드 목록을 어디서?** 현행은 세션별 도메인 용어를 사전 수집하지 않는다. 키워드 파이프라인을 켜려면 프로젝트/세션에 용어집을 입력받는 신규 UX 가 선행돼야 함(별도 제품 작업).

**정리:** keywords 는 흥미롭지만, 화자분리 상호배타 + 이미 견고한 post-pass + 용어집 수집 UX 부재로 **현시점 순이득 없음.**

---

## §한계 (교체 시 신규로 떠안는 것)

- **25 MB 하드 상한** (OpenAI audio API, mp3/mp4/mpeg/mpga/m4a/wav/webm). 90분 인터뷰(수십~수백 MB)는 클라이언트 청킹 → 병렬 전사 → 세그먼트 스티칭 → **청크 경계 화자 재정렬**이 필요. 현행 Scribe/Deepgram 은 `cloud_storage_url`/signed URL 로 장시간 파일을 async 처리해 이 문제가 애초에 없음. **핵심 유스케이스를 정면으로 깨는 리스크.**
- **16k 컨텍스트 / 2k 출력 토큰** (diarize) — 긴 전사에서 출력 잘림 위험.
- **웹훅 비의존 async 부재** — OpenAI 배치 전사는 동기형이라 Vercel 60s 예산과 충돌(현행이 webhook async 로 우회한 바로 그 문제 재발).

---

## §케이스 발췌 템플릿 (운영자 런이 채움)

`node --experimental-strip-types --env-file-if-exists=.env.local scripts/spikes/stt-eval.ts <샘플디렉토리> --lang ko --keywords "브랜드명,제품명,전문용어" --judge` 실행 시 `<샘플디렉토리>/_stt-eval-out/` 에 아래가 생성됨:
- `*.<engine>.txt` — 엔진별 전사 원문
- `*.judge.json` — Scribe/Deepgram(baseline) vs gpt(candidate) divergence 목록(조사/용어/화자/누락 kind 별)
- `summary.md` — 나란히 비교 + ms/문자수/비용 표

여기서 각 엔진이 틀린 대표 사례 3~5개(한국어 조사 결합 · 전문용어 · 화자 전환 경계)를 뽑아 이 절에 붙이면 결론이 실오디오로 확증된다. **현 결론은 이 런 없이도 §비용·§정확도·§한계로 결정적**임에 유의.

---

## §심판 프롬프트 (재현성)

스크립트 `JUDGE_SYSTEM` 상수와 동일:

> You compare two speech-to-text transcripts of the SAME audio. You cannot hear the audio, so judge only from internal evidence. List CONCRETE divergences where the two transcripts disagree, and for each, say which reading is more plausible and why. Focus on: (1) Korean 조사/어미 attachment errors, (2) domain/proper-noun spelling variants, (3) speaker-turn boundary disagreements, (4) dropped/hallucinated spans. Return STRICT JSON: `{"divergences":[{"kind":"josa|term|speaker|dropped|other","a":"…","b":"…","likelier":"a|b|unclear","why":"…"}],"summary":"…"}`.

---

## 후속 권고 (교체 시 범위 — 지금은 착수 불필요)

전면 교체는 권장하지 않는다. 만약 향후 재검토한다면 범위는 **"영어·단문(<25 MB, <~20분)·용어 밀집 클립에 한해 `gpt-transcribe` 키워드 조건을 Deepgram 과 병렬 A/B"** 하나로 좁힌다(비용 우위 $0.36<$0.462/hr + 키워드 이득이 겹치는 유일 교집합, 화자분리 요구가 약한 짧은 클립). 그 니치조차 현재 우선순위는 낮으므로 별도 티켓을 지금 만들 필요는 없다. 한국어 배치 전사·장시간 인터뷰는 Scribe 유지가 정답이며, 개선 여력은 엔진 교체가 아니라 **post-pass 용어집 입력 UX**(키워드/term-normalize 를 세션 용어로 시드)에서 더 크다.

---

## §출처

- OpenAI — File transcription 가이드 (`gpt-transcribe` 권장 모델, `prompt`/`keywords`/`languages` 지원, 25 MB·포맷 상한, `diarized_json`): https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI — `gpt-4o-transcribe-diarize` 모델 (토큰 과금 $2.5/1M in · $10/1M out, 16k ctx / 2k out, 프롬프트 미지원, known-speaker 참조): https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize
- OpenAI — `gpt-4o-transcribe` 모델: https://developers.openai.com/api/docs/models/gpt-4o-transcribe
- Deepgram — Pricing (Nova-3 monolingual $0.0077/min · multilingual $0.0092/min, pre-recorded): https://deepgram.com/pricing
- ElevenLabs — API Pricing (Scribe batch STT $0.22/hr, 2026-06-29 인하): https://elevenlabs.io/pricing/api
- ElevenLabs — Speech to Text (Scribe 한국어 FLEURS ~3.1% WER): https://elevenlabs.io/speech-to-text/korean
- FLEURS 다중 시스템 비교(상위 시스템 1~2pp 밴드, gpt-4o-transcribe "close behind" Scribe): https://www.coval.ai/blog/best-speech-to-text-providers-in-2026-independent-benchmarks-and-how-to-choose/
- 내부 A1 실측(Scribe v2 vs Deepgram nova-2, 90분 한국어 인터뷰 2.15× recall): [`src/lib/transcripts/languages.ts`](../../src/lib/transcripts/languages.ts) 헤더 주석
