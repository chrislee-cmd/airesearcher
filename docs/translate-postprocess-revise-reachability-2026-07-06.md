# 동시통역 revise / post-process 도달성 검증 리포트 (2026-07-06)

> spec: `pr-translate-postprocess-revise-reachability-verify` (verify-first, fix 아님)
> 방법: Supabase 전수 쿼리 (service role, REST) + `src/components/translate-console.tsx` 게이팅 코드 정독
> 기준선: recording-reserve hotfix **PR #550** merge = `2026-06-30T03:43:10Z` 이후/이전 분리

---

## 0. 한 줄 결론

사후 보정 2종(revise · post-process)이 전 역사 0건인 원인은 **가설1(녹음 행 미생성)이 아니라 가설2(패널 도달성)** 다.
녹음 행은 hotfix 이후 정상 생성(82% 성공, 44개 세션은 `uploaded` 완료)되어 패널 게이팅(`recording !== null` + `ready`)이 **완전히 충족**됐는데도 0클릭 —
즉 기능은 살아 있으나 **사용자가 도달하는 UI 경로가 사실상 존재하지 않는다**. 과금(가설3, 각 10 credits)은 이미 좁은 도달 창을 더 억제하는 **부차 요인**.

**→ 이 PR 은 코드 변경 없음 (검증 리포트).** 후속 조치 = 별도 "도달성 UX" spec (§5).

---

## 1. 검증 데이터 (Supabase 전수, 2026-07-06)

### 1.1 사후 보정 실행 = 전 역사 0건 (재확인)

| 지표 | 전 역사 count |
|---|---|
| `translate_sessions.post_process_status != 'idle'` | **0** |
| `translate_sessions.post_process_md IS NOT NULL` | **0** |
| `translate_sessions.glossary != '[]'` (비어있지 않음) | **0** |
| `translate_messages.revised_text IS NOT NULL` | **0** |

→ post-process · revise · glossary **한 번도 실행/입력 안 됨.**

### 1.2 녹음 행 = 정상 생성 (가설1 반증의 핵심)

| 지표 | 전 역사 | hotfix(#550) 이후 |
|---|---|---|
| `record_enabled=true` 세션 | 221 | 74 |
| `status='ended'` 세션 | 132 | 50 |
| `translate_recordings` 행 (세션당 1행) | 146 | 61 |
| ↳ `status='uploaded'` (다운로드/보정 가능 완료) | 89 | **44** |
| ↳ `status='recording'` (finalize 미완) | 43 | — |
| ↳ `status='failed'` | **0** | 0 |
| ↳ `status='unlocked'` (구 과금 스킴) | 14 | — |

- hotfix 이후 `record_enabled` 74 세션 중 **61 세션(82%)** 에 녹음 행 생성 → reserve 경로 정상.
- 그중 **44 세션이 `uploaded`** = `ready === true` = revise 버튼 `disabled` 해제 + post-process 트리거 가능 = **패널 완전 활성 상태.**
- 최신 녹음 생성 = `2026-07-06T03:22Z` (오늘) — reserve 경로 **현재도 정상 작동.**

**결론: 가설1(reserve 실패로 패널 영영 안 뜸)은 반증됨.** PR #550 hotfix 로 해소됐고, 44개 세션은 패널이 뜰 모든 조건을 만족했다.

---

## 2. 코드 게이팅 정독 (`src/components/translate-console.tsx`)

### 2.1 패널 렌더 조건 — 종료 시 같은 탭에만, 재진입 없음

```tsx
// :3565  RecordingDownloadPanel(revise + PostProcessPanel 포함) 마운트 조건
{status === 'ended' || (recording && status !== 'live') ? ( ... ) : null}

// :3654  revise 노출:      showRevise = recording !== null && revisionStatus !== null
// :3760  PostProcessPanel: recording !== null && sessionId
// :3646  ready = recording && status ∈ {uploaded, unlocked}  (revise/postprocess 버튼 활성 조건)
```

- 패널은 `/canvas` 의 translate 카드 안 `<TranslateConsole>` 이 `status==='ended'` 로 전이할 때 렌더.
- **`setStatus('ended')` 는 `stop()`(:2986) 에서만 발생.** 컴포넌트 mount 시 이전 세션을 하이드레이트하는 경로가 **없다** — 초기 `status='idle'`(:555), `sessionIdRef` 초기 `null`(:740), URL 파라미터·localStorage 로 종료 세션을 복원하는 로직 부재.
- 즉 패널은 **"정지 버튼 클릭 직후 ~ 새로고침/이탈/새 세션 시작 전"** 의 같은 탭 창에서만 보인다. 종료 세션 히스토리·재진입 UI 자체가 존재하지 않는다.

### 2.2 도달 시나리오의 현실

사용자 여정: 통역이 목적 → 실시간 자막/음성으로 목적 달성 → 세션 정지 → **작업 완료로 인지하고 이탈**. 정지 후 카드 하단에 나타나는 revise/post-process 패널을 인지하고 머무를 유인·안내가 없다. 새로고침하면 idle 로 초기화되어 그 세션으로 **영영 돌아갈 수 없다.**

---

## 3. 가설 판정

| 가설 | 판정 | 근거 |
|---|---|---|
| **1. recording 행 미생성 (reserve 실패)** | ❌ **반증** | hotfix 이후 82% 생성, 44 세션 `uploaded` 완료, failed 0, 오늘도 생성 중 |
| **2. 패널 도달성 부재** | ✅ **확정 (주원인)** | 패널은 종료 직후 같은 탭에만 렌더 · 재진입/히스토리 경로 없음 · 44개 완전 활성 세션도 0클릭 |
| **3. 유료 장벽 (각 10 credits)** | 🟡 **부차 기여** | revise `REVISE_CREDITS=10`, post-process `POSTPROCESS_CREDITS=10`. 이미 좁은 도달 창을 더 억제하나, 무료여도 이 도달 프로필이면 사용률은 여전히 0에 수렴 |

---

## 4. 하지 않은 것 (spec 제약 준수)

- ❌ post-process 자동 트리거 미부착 — 세션 종료 시 자동 실행 = credits 자동 소모 = 과금 리스크(spec §결정 2). 원인이 도달성으로 확정됐어도 자동 트리거는 답이 아니다(사용자 opt-in 없는 과금).
- ❌ fix 코드 미작성 — verify-first. 도달성 UX 개선은 §5 별도 spec(1작업=1PR).

---

## 5. 후속 조치 (spec writer / jarvis 회신)

spec 의 분기표상 결과 = **"recordings 생김 + 패널 미도달 → 가설2 → 도달성 UX spec"**.

권고하는 후속 spec = **"동시통역 종료 세션 재진입 + 사후 보정 패널 노출 강화"** (신규, 이 PR 과 분리):

1. **종료 세션 재진입 경로** — canvas translate 카드/fullview 에서 최근 종료 세션 목록 → 선택 시 `status='ended'` 로 하이드레이트(녹음 행 + revise/post-process 상태 로드). 현재 새로고침 시 세션이 소실되는 것이 최대 병목.
2. **정지 직후 능동 안내** — 세션 정지 시 "보정된 전사록 받기(post-process) / 재번역(revise)" CTA 를 카드 상단에 눈에 띄게 노출(현재는 다운로드 섹션 하단에 조용히 등장).
3. **(선택) 과금 표기 명확화** — 10 credits 사전 고지 + 결과 미리보기로 가치 전달.

> 이 리포트는 별도 handoff 파일을 만들지 않음(워커 규칙). 후속 spec 작성은 spec writer 몫 — 본 리포트 + PR 본문이 근거.

---

## 6. 재현 쿼리 (참고)

```bash
# 기준: reserve hotfix(#550) merge = 2026-06-30T03:43:10Z
# translate_recordings status 분포 (hotfix 이후)
GET /rest/v1/translate_recordings?select=status&created_at=gte.2026-06-30T03:43:10Z
# 사후 보정 실행 여부
GET /rest/v1/translate_sessions?select=id&post_process_status=neq.idle           # → 0
GET /rest/v1/translate_messages?select=id&revised_text=not.is.null               # → 0
```
