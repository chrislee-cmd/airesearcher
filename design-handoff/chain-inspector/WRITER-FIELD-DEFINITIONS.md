# WRITER FIELD DEFINITIONS — 체인 인스펙터 선언형 스키마 (writer → 워커)

_2026-10-13 · writer. CD 번들 `README.md §8`("writer 정의가 필요한 것")에 대한 응답이며, **구현의 SSOT** 입니다._

> **범위**: 체인 노드 4종 전부 — `probing` · `transcripts` · `interview_ingest` · `topline`.
> CD 는 파일럿 3종(프로빙·전사록·인터뷰 결과)만 컴프에 그렸지만, **인스펙터는 체인에 들어올 수 있는 모든 노드를 렌더**해야 하므로 `topline` 까지 정의합니다. 노드 집합 근거 = `src/lib/chains/registry.ts` `CHAIN_STEPS`.
> CD 컴프의 필드 값은 **제안**이고, 이 파일의 값이 **확정**입니다 (CD README §8 명시).

---

## 0. 먼저 — 조사에서 드러난 구멍 3건 (구현 전 반드시 읽을 것)

### 구멍 ① 단계 설정을 저장할 곳이 없다 (백엔드 신설 필요)

`ChainStepInstance`(registry.ts:120)는 **`feature` · `status` · `job_ref` · `cost_at_creation` · `error` 5필드뿐**입니다. 설정값을 담을 필드가 **없습니다.**

즉 지금 체인의 각 단계는 **설정이라는 개념 자체가 없이** 돌고 있습니다 — 프로젝트는 체인 레벨(`widget_chains.project_id`)에서 오고, 전사 언어는 어댑터가 `multi` 기본값으로 넘깁니다(`adapters.ts:442`). CD 가 설계한 "미설정 → 설정하기 → 자동 저장 → 카드 요약 반영" 전체가 **저장소 없이는 성립하지 않습니다.**

**→ 이번 작업은 프론트 전용이 아니고 `steps[].config` jsonb 신설 + 저장 API 가 선행**입니다. 계약은 §5 에 정의했습니다. CD README "안 바뀌는 것: 체인 계약(`ChainView`)" 은 **UI 계약을 뜻하고, 영속 계약은 바뀝니다** — CD 가 몰랐던 사실이므로 CD 이탈이 아닙니다.

### 구멍 ② 프로젝트는 단계 설정이 아니라 체인 설정이다

기존 위젯 셋업 아코디언은 4종 모두 **1단계가 "프로젝트 선택"** 입니다(`probing/setup-accordion.tsx:215`, `transcript-setup-accordion.tsx:102`, `interviews-card.tsx:192`). 그런데 체인에서는 프로젝트가 **체인 1개당 하나**(`widget_chains.project_id`)이고, 어댑터가 그 값을 모든 단계에 전파합니다(`adapters.ts:590` `const projectId = chain.project_id`).

**→ 인스펙터의 각 단계에 프로젝트 필드를 두지 않습니다.** 단계마다 프로젝트를 고르게 하면 체인 안에서 서로 다른 프로젝트를 가리킬 수 있게 되고, 어댑터는 그걸 무시하므로 **"설정했는데 반영 안 되는 필드"** 가 생깁니다. 대신 인스펙터 본문 맨 위에 **읽기 전용 행**(CD §4.4 「앞 단계 입력」 포맷 재사용, 칩 문구만 "체인 공통")으로 프로젝트를 보여줍니다. 변경은 체인 레인 헤더에서 (이번 범위 밖, 기존 경로 유지).

### 구멍 ③ 설정이 0개인 단계가 있다 — 5번째 상태가 필요하다

`interview_ingest` 는 체인 안에서 **사용자가 정할 것이 하나도 없습니다** — 입력은 앞 단계 전사록이 자동으로 오고(`kickInterviewIngestFromTranscript`), 분석 옵션은 API 에 없습니다(`convert` → `index` 는 project_id + 파일만 받음). CD 의 4상태(unset/ready/running/done)에는 **"설정할 것이 없어서 처음부터 ready"** 가 들어갈 자리가 없습니다.

**→ writer 판정: `requiredFields` 가 빈 배열이면 unset 을 건너뛰고 ready 로 시작**합니다. 카드 푸터의 액션은 "편집" 대신 **"입력 보기"**(인스펙터 열기 — 앞 단계 입력 읽기 전용 행만 들어 있음)로 둡니다. "설정하기" 주 버튼은 그리지 않습니다 (누를 것이 없는 버튼 금지).

**→ CD 회신 확정 (2026-10-16, `.dc.html` I1 5번째 칸 `noconfig`)**: 위 판정이 채택됐고 디테일이 더해졌습니다. 더 이상 열린 질문이 아닙니다.

| 항목 | CD 확정값 |
|---|---|
| 배지 | **`idle` "준비됨" 그대로** — 5번째 상태를 신설하지 않습니다(상태 어휘 불변) |
| 본문 | 입력 출처 **읽기 전용 행 2개**(예: `입력` = "2단계 전사록 · 자동" · `프로젝트 문서` = "12건 함께 분석") |
| "외 n개" 자리 | 문구 **"따로 설정할 것이 없어요"** 로 대체 |
| 푸터 왼쪽 | 예상 비용 그대로(예: `💎10 예상`) |
| 푸터 액션 | **"입력 보기"** — 텍스트 액션, `ready` 의 "편집"과 **같은 자리** (주 버튼 아님) |
| 진입 | `requiredFields` 가 0개면 **unset 을 거치지 않고 ready 로 시작** |

CD 원문(컴프 `rule` 필드): _"requiredFields · 편집 필드가 0개면 unset 을 거치지 않고 ready 로 시작합니다. 본문 = 입력 출처 행 + "따로 설정할 것이 없어요". 푸터 액션 = "입력 보기"(텍스트, "편집"과 같은 자리). 배지는 ready 그대로입니다."_

### 함께 — 라이브 편집은 인스펙터가 아니다

프로빙의 **조사 목적·질문 주입·페르소나 패널**은 세션 *중* 쓰는 기능입니다(`probing/question-pane.tsx`, `reflection-pane.tsx`). CD §5 는 "실행 중 단계는 인스펙터 읽기 전용"이라 했으므로, 이 둘은 모순처럼 보입니다.

**→ writer 판정: 인스펙터는 "실행 전 설정"만 담습니다.** 실행 중 라이브 조작은 CD 가 §5 하단에 열어 둔 **"진행 보기 ↗" → 기존 풀뷰** 경로로 갑니다. 즉 조사 목적의 *초기값* 은 인스펙터 §조사 맥락에서 설정하고, 세션 중 수정은 풀뷰에서 합니다. 모순 없이 둘 다 성립합니다.

---

## 1. 공통 규칙

| 항목 | 값 |
|---|---|
| 요약 행 | 최대 3행, 4번째부터 "외 n개 설정" (CD §1.4) |
| 레이블 | **6자 이내** 한글. 값은 한 줄 말줄임 |
| 레이블 출처 | 전부 `messages/*.json` 경유 (`check:i18n` 4로케일 parity 대상). 아래 표의 한글은 **ko 기준값** |
| 필수 판정 | `requiredFields` 전부 채워지면 ready. 하나라도 비면 unset + 체크리스트(최대 3) |
| 앞 단계 공급 | `source: 'upstream'` 필드는 **필수 계산에서 제외**하고 읽기 전용 행으로 렌더 |
| 기본값 | 체인 단계에서는 **품질을 좌우하는 필드에 기본값을 두지 않는다**(§2 각주) — 무인 진행이라 잘못된 기본값으로 돌면 세션 전체가 버려진다 |
| **필수 판정 대상** | **unset 판정 = `requiredFields` ∩ 사용자가 `config` 에 넣을 수 있는 필드.** 선언은 유지하고 **판정에서 걸러낸다** — 파일 업로드·녹음처럼 config 밖 경로가 소유하는 입력을 세면 **영구 unset → 영구 paused** 가 된다(§3.2 2차 정정). 필터는 **단일 판정자 안에** 둔다 |
| 완료 요약 | done 상태의 3행은 **설정이 아니라 결과**(CD §1.3) — 별도 `doneFields` 로 선언 |

---

## 2. `probing` — 인터뷰 어시스턴트 (25cr)

출처: `src/components/canvas/widgets/probing/setup-accordion.tsx`

### 2.1 summaryFields (ready)
| 순서 | 레이블 | 값 | 원천 |
|---|---|---|---|
| 1 | 입력 | 오프라인 / 온라인 / 참관 | `source` (mic·both·tab) |
| 2 | 출력어 | 한국어 / English / … | `outputLang` |
| 3 | 질문 | n개 주입 | `questions.length` (0이면 "없음") |

### 2.2 requiredFields
`source` · `outputLang`

> **기본값 제거**: 단독 위젯에서는 `source` 가 `mic` 로 시작하지만, **체인에서는 비워 둡니다.** 온라인 인터뷰를 오프라인 캡처로 돌리면 상대 음성이 통째로 빠지고, 체인은 무인이라 그걸 알아차릴 사람이 없습니다. 이것이 unset 상태가 존재하는 이유입니다.

### 2.3 doneFields (완료 카드)
| 순서 | 레이블 | 값 |
|---|---|---|
| 1 | 질문 | n개 생성 |
| 2 | 길이 | 48분 |
| 3 | 녹음 | 있음 / 없음 (다음 단계 입력 가능 여부) |

### 2.4 inspectorSchema
```
섹션 1 「입력」          설명: 인터뷰를 어떻게 듣는지 정합니다
  · source          세그먼트 3 (오프라인 · 온라인 · 참관)   필수
섹션 2 「언어」
  · outputLang      select                                  필수
섹션 3 「질문」          설명: 세션 중 AI 가 참고할 질문을 미리 넣어 둡니다
  · questions       순서 목록 (+ 항목 추가)                 선택
섹션 4 「조사 맥락」     설명: 세션 중에도 풀뷰에서 바꿀 수 있어요
  · researchGoal    textarea (min-h 78)                     선택
```

---

## 3. `transcripts` — 전사록 생성기 (1cr)

출처: `src/components/canvas/widgets/transcript-setup-accordion.tsx`

### 3.1 summaryFields (ready)
| 순서 | 레이블 | 값 | 원천 |
|---|---|---|---|
| 1 | 방식 | 리서치 인터뷰 / 회의록 | `method` (research·meeting) |
| 2 | 언어 | 한국어 / 자동 감지 / … | `language` |
| 3 | 입력 | 앞 단계 녹음 / 파일 n개 | upstream 또는 `audio` |

### 3.2 requiredFields
- **체인 2번째 이상** (앞에 `probing` 이 있음): `method` · `language` — `audio` 는 `source: 'upstream'`
- **체인 첫 단계**: `method` · `language` — **`audio` 는 필수 집합에서 제외** (아래 정정)

> 같은 위젯이 체인 위치에 따라 필수 집합이 달라집니다. `requiredFields` 는 **정적 배열이 아니라 `(position, upstreamFeature) => string[]`** 로 선언해야 합니다 (§5.2).

> **⚠️ writer 정정 (2026-10-16, `#1349` 워커 발견 — 초판이 틀렸습니다). 2차 정정으로 *기제*까지 명시합니다.**
>
> **문제**: 초판은 "체인 첫 단계면 `audio` 도 필수" 라고 적었고 `ui-meta.ts` 가 그대로 선언했습니다(`requiredFields` 가 position 0 에서 `['method','language','audio']`). 그런데 `audio` 는 드롭존/녹음으로 들어오는 **파일**이고 `steps[].config` 에 사는 값이 아닙니다. `requiredFields` 충족은 config 키로 판정하므로, **사용자가 파일을 올려도 unset 이 해제되지 않습니다 → 영구 unset → 영구 paused.**
>
> **해법 = 선언을 지우는 것이 아니라 판정에 필터를 둔다 (writer 판정).**
> `ui-meta` 의 `requiredFields` **선언은 그대로 유지**합니다 — 그 선언은 "이 입력 없이는 단계가 돌 수 없다" 는 사실이고, 호환 그래프가 넓어져 녹음을 공급하지 않는 선행이 생기면 그때 필요한 정보입니다(`ui-meta.ts` 의 방어적 주석 근거).
> **unset 판정은 `requiredFields ∩ 사용자가 config 에 넣을 수 있는 필드`** 로 계산합니다. 즉 `kind` 가 입력 컨트롤인 필드만 세고, `dropzone` 처럼 config 밖 경로가 소유하는 입력은 **세지 않습니다**. (`#1349` 의 `isUserConfigurableField` 가 이 필터입니다.)
>
> **정답값**: `transcripts` position 0 의 미설정 체크리스트 = **`[]`** (`['audio']` 아님). 파일 부재는 인스펙터 unset 이 아니라 **기존 전사록 위젯의 실행 가드**가 다룹니다.
>
> **⚠️ 이 필터는 단일 판정자 안에 있어야 합니다.** 2026-10-16 현재 `step-config.ts` 의 `missingRequiredFields` 는 필터가 **없고**(옛 판정 = `['audio']`), `#1349` 의 `card-state.ts` 는 **있습니다**(`[]`) — 같은 이름의 두 함수가 **다른 답**을 냅니다. 통합은 `pr-chain-unset-paused-transition` 범위이고, **통일 방향은 필터가 있는 쪽(`[]`)** 입니다. 그 PR 은 `tests/chain-step-config.test.ts` 의 옛 기대값(L153·L368 `['audio']`)도 함께 고쳐야 합니다.

### 3.3 doneFields
| 순서 | 레이블 | 값 |
|---|---|---|
| 1 | 분량 | 48분 · 8,200자 |
| 2 | 화자 | 2명 |
| 3 | 산출물 | 전사록 1건 |

### 3.4 inspectorSchema
```
섹션 1 「방식」          설명: 전사 후 어떤 형태로 정리할지 정합니다
  · method          세그먼트 2 (리서치 인터뷰 · 회의록)     필수
섹션 2 「언어」
  · language        select (자동 감지 포함)                 필수
섹션 3 「입력」
  · audio           upstream → 읽기 전용 행 (앞 단계 톤 타일 + "프로빙 녹음 · 48분")
                    첫 단계 → 드롭존 + "또는" + 녹음 버튼   필수(첫 단계만)
```

---

## 4. `interview_ingest` — 인터뷰 결과 생성기 (10cr)

출처: `src/components/canvas/widgets/interviews-card.tsx` · `interviews/mode-bodies.tsx` · `adapters.ts` 어댑터 2

### 4.1 summaryFields (ready)
| 순서 | 레이블 | 값 | 원천 |
|---|---|---|---|
| 1 | 입력 | 앞 단계 전사록 | upstream |
| 2 | 문서 | n건 | 체인 프로젝트에 이미 적재된 문서 수 |
| 3 | — | (없음 — 2행으로 끝) | |

### 4.2 requiredFields
**빈 배열** → 구멍 ③ 규칙 적용. unset 없음, 처음부터 ready, 푸터 액션 "입력 보기".

### 4.3 doneFields
| 순서 | 레이블 | 값 |
|---|---|---|
| 1 | 분석 | 인용 n개 · 주제 n개 |
| 2 | 문서 | n건 인덱싱 |
| 3 | 산출물 | 인터뷰 결과 1건 |

### 4.4 inspectorSchema
```
섹션 1 「입력」
  · upstreamTranscript   읽기 전용 행 (앞 단계 전사록 · 제목 · 분량)
  · projectDocuments     읽기 전용 행 (프로젝트 문서 n건)
섹션 2 없음 — 설명 한 줄: "이 단계는 앞 단계 결과를 그대로 분석해서 따로 설정할 것이 없어요."
```
하단 진행도는 "필수 0 / 0" 대신 **"설정 없음"**(ok 톤)으로 둡니다.

---

## 5. `topline` — 전체 리포트 생성기 (무과금)

출처: `src/app/api/interviews/v2/topline/route.ts:267` — `{ project_id, force, output_lang, user_direction, allow_partial }`

### 5.1 summaryFields (ready)
| 순서 | 레이블 | 값 | 원천 |
|---|---|---|---|
| 1 | 출력어 | 한국어 / English | `output_lang` |
| 2 | 방향 | 지정함 / 기본 | `user_direction` 유무 |
| 3 | 부분 | 허용 / 전체 완료 대기 | `allow_partial` |

### 5.2 requiredFields
`output_lang`

### 5.3 doneFields
| 순서 | 레이블 | 값 |
|---|---|---|
| 1 | 보고서 | 토플라인 1건 |
| 2 | 분량 | n자 |
| 3 | 생성 | 10/13 14:22 |

### 5.4 inspectorSchema
```
섹션 1 「출력」
  · output_lang     select                                  필수
섹션 2 「작성 방향」     설명: 보고서가 어디에 초점을 둘지 한두 문장으로
  · user_direction  textarea (min-h 78)                     선택
섹션 3 「고급」
  · allow_partial   토글 — "일부 단계가 실패해도 보고서를 만들어요"  선택
```
> `force`(강제 재생성)는 **설정이 아니라 재실행 동작**이므로 인스펙터에 두지 않습니다. 완료 단계의 "결과 보기 ↗" 풀뷰에서 기존 경로로 재생성합니다.

---

## 6. 선언형 계약 (워커가 구현할 것)

### 6.1 저장소 — `steps[].config`
```ts
// registry.ts — ChainStepInstance 확장
type ChainStepInstance = {
  feature: string;
  status: ChainStepStatus;
  job_ref: string | null;
  cost_at_creation: number;
  error?: string | null;
  // 신설: 이 단계의 사용자 설정. 키 = inspectorSchema 의 필드 id.
  // 미설정 단계는 없거나 {} (기존 steps jsonb 와 하위호환 — optional).
  config?: Record<string, unknown> | null;
};
```
- 기존 row 는 `config` 가 없으므로 **반드시 optional** — 없으면 `{}` 로 읽습니다.
- **어댑터가 config 를 읽어야 실효**가 생깁니다. 지금 하드코딩/기본값으로 넘기는 두 지점을 config 우선으로 바꿉니다: `adapters.ts:442`(전사 language) · 전사 method · topline `output_lang`/`user_direction`/`allow_partial`. **config 를 저장만 하고 어댑터가 무시하면 ①과 같은 "반영 안 되는 필드" 를 다시 만드는 것**이므로 Done-when 입니다.

### 6.2 메타 선언
```ts
type ChainStepFieldDef = {
  id: string;
  labelKey: string;            // messages 경로. 해석값 6자 이내(ko)
  kind: 'segment' | 'select' | 'textarea' | 'toggle' | 'orderedList' | 'dropzone' | 'readonly';
  section: string;             // 섹션 labelKey
  source?: 'user' | 'upstream' | 'chain';  // 기본 'user'
  options?: ReadonlyArray<{ value: string; labelKey: string }>;
  hintKey?: string;
};

type ChainStepUiMeta = {
  summaryFields: readonly string[];                 // 최대 3, 순서 그대로
  doneFields: readonly string[];
  // 위치 의존이므로 함수 (§3.2). 반환 배열이 비면 unset 생략(§0 구멍 ③)
  requiredFields: (ctx: { position: number; upstream: ChainStepKey | null }) => readonly string[];
  inspectorSchema: readonly ChainStepFieldDef[];
};
```
- **위젯별 하드코딩 0** (CD Done-when). 카드와 인스펙터는 공용 렌더러 1개가 이 메타만 읽습니다.
- 이 메타의 거처는 `src/lib/chains/registry.ts` 옆 **`src/lib/chains/ui-meta.ts`** 로 둡니다 — registry 는 클라이언트-안전 제약(파일 머리 ⚠)이 걸려 있고 ui-meta 도 같은 제약을 지켜야 하므로 같은 레이어에 둡니다.

### 6.3 저장 API
- `PATCH /api/chains/<id>/steps/<index>/config` — body = 부분 config(머지). 응답 = 갱신된 `ChainView`.
- 낙관적 반영 → 디바운스 400ms (CD §4.5). 실패 시 하단 진행도 자리에 err + 재시도 1버튼, 마지막 값 유지.
- **running·done 단계는 서버에서 거절**(409) — 클라 잠금만 믿지 않습니다(CD §5 의 서버측 대응물).

---

## 7. proposed-token 2건 (등재 필요)

**CD 회신으로 1건이 소멸했습니다 (2026-10-16).** 남은 등재 대상은 **1건**입니다.

| hex | 용처 | 처리 |
|---|---|---|
| ~~`#fcfcfd`~~ → **`#fafafa`** | unset 요약 카드 면 (CD §1.3) | **신규 토큰 불요** — CD 가 컴프에서 `#fafafa` 로 교체했고, 이는 **기등재 `--surface-2`**(`globals.css:523` · `tokens.css:14` "sidebar, muted panels") 와 같은 값입니다. `--surface-2` 를 그대로 씁니다 |
| `#e9e7ec` | 잠금 상태의 선택된 세그먼트·칩 (CD §5) | **미등재 — 등재 필요.** 제안 `--fill-locked-on` (이름 이견 없으면 이대로) |

> 이 교체는 AUTHORITY 위반이 아닙니다. 「CD 값을 가까운 DS 기본값으로 굽히지 말라」는 **워커가 임의로 바꾸는 것**을 금지하는 규칙이고, 여기서는 **CD 가 직접 자기 값을 기존 토큰 값으로 옮겼습니다.** 권위는 CD 쪽에 그대로 있습니다.

---

## 8. 워커가 읽을 순서

1. `design-handoff/chain-inspector/README.md` — CD 정본 (치수·상태·동작)
2. `design-handoff/chain-inspector/chain-inspector-scenes.dc.html` — 비주얼 SSOT (I0–I4 + Q1–Q6)
3. **이 파일** — 필드 정의 + 구멍 3건 + 저장 계약
4. `design-handoff/soft-identity/README.md` + `tokens.css` — 토큰
5. `design-handoff/canvas-modular/full/README.md` · `design-handoff/widget-chain/v3/` — 치수 SSOT (레인·세그먼트)

> ⚠️ **`design-handoff/README.md` 는 리브랜드 이전(Memphis) 문서**입니다 — `border: 3px solid #1d1b20` · `4px 4px 0` 하드 그림자 · 배너 옐로를 아직 "절대값"으로 말합니다. #1335 에서 전부 퇴역했으므로 **이번 작업의 진입점으로 쓰지 마십시오.** (문서 갱신은 별건 부채.)
