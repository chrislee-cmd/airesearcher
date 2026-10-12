# LEARNINGS — pr-rebrand-soft-stage2 (Soft Identity 리브랜드 2단계)

_2026-10-12 · PR #1335 (main `6cea0ab8`) + 잔존 수정 #1338 · 커밋 금지(워크트리 로컬)_

---

## 1. 인라인 style 문자열 리터럴 = 클래스 스윕·토큰 스윕 **둘 다** 빠져나가는 제3 경로 ⭐

**사건.** 작업 6(Memphis 토큰 삭제)을 끝내고 "정적 grep 0 · 미정의 참조 0"을 기계로 증명한 뒤 프리뷰를 실측했더니, `/ko/credits` 가 **하드 오프셋 15 · 1px 초과 보더 115** 로 남아 있었다. 정적 grep 은 0 이었는데 런타임은 0 이 아니었다.

**원인.** 폭·그림자가 세 번째 경로에 있었다 —

```tsx
// ① Tailwind 클래스 (내 클래스 스윕이 잡음)
className="border-2 shadow-memphis-md"
// ② 토큰 참조 (내 토큰 스윕이 잡음)
style={{ boxShadow: 'var(--memphis-shadow-sm)' }}
// ③ 인라인 style **문자열 리터럴** ← 둘 다 안 잡힘
style={{ border: '3px solid var(--canvas-card-border)',
         boxShadow: '4px 4px 0 var(--canvas-card-border)' }}
```

③ 이 특히 교활한 이유: 작업 6 의 Layer 2 재지정으로 **색은 이미 `--line` 이 돼 있었다.** 그래서 토큰 대조(45/45 일치)로도 안 걸리고, 화면에는 "회색 3px + 회색 오프셋"이라는 어중간한 Soft-Memphis 혼종이 남았다. 색만 보면 통과처럼 보인다.

**그리고 ③ 안에서 또 갈라진다.** 1차 수정(68곳)으로도 43건이 남았는데, 단일 인용 리터럴만 보는 정규식이 아래를 놓쳤다:

| 하위 경로 | 예시 |
|---|---|
| 템플릿 리터럴 + 조건식 | `` border: `${active ? 3 : 2.5}px solid …` `` |
| 템플릿 리터럴 + 삼항 문자열 | `` border: `${popular ? '4px' : '3px'} solid …` `` |
| `borderWidth` 단독 속성 | `borderWidth: '1.4px'` |
| 템플릿 리터럴 + 상수 보간 | `` border: `1.5px solid ${INK}` `` |
| **CSS 변수 자체가 보더 선언** | `--cd-solid-border: 1.5px solid …` (globals.css) |

**규모.** 1차 68곳/20파일 + 2차 12파일. 즉 "클래스 grep 0"을 달성한 뒤에도 **80곳 가까이** 남아 있었다.

**재검색 정규식 (이걸 쓰면 세 경로 전부 잡힌다).**

```bash
grep -rnE "borderWidth: '1\.[0-9]px'|[2-9](\.[0-9])?px solid|1\.[34689]px solid|[0-9]+px +-?[0-9]+px +0" src \
  | grep -vE 'landing.css|login.css|lib/reports/prompts|7px solid transparent|11px solid|outline: [23]px solid transparent'
```

**측정 grep 이 제3 경로를 못 덮으면 "0건"이 거짓이 된다 (사후 재발).** 머지 후 독립 확인에서 "보더 적용 스타일 잔존 0" 이라는 측정이 올라왔는데, 실제로는 main 에 3건이 살아 있었다 — `border: '3px dashed …'`(dashed 형태) · `` border: `3px dashed ${INK}` ``(템플릿 리터럴) · `` border: `${active ? 3 : 2.5}px solid …` ``(조건식). 같은 측정에서 잡힌 2건(`interpreter-fullview:459` · `recruiting-journey-shell:195`)은 `eslint-disable` **주석 문자열**이라 v5 기준 제외 대상이었고, **주석 2건과 적용 스타일 3건은 서로 다른 줄**이었다. 한쪽을 다른 쪽으로 환원해 "피해는 주석뿐"으로 축소하면 실제 렌더되는 3건이 그대로 남는다. → **"0건" 보고를 받으면 측정에 쓴 정규식을 함께 받아서 경로 커버리지를 확인하라.** 특히 dashed·템플릿 리터럴·조건식은 단일 인용 리터럴 패턴에 안 걸린다.

**교훈.** 시각 값 스윕의 완료 판정은 **정적 grep 으로 끝내면 안 된다.** grep 은 "내가 생각한 표현 경로"만 덮고, 값을 넣는 경로는 최소 3개(클래스 · 토큰 참조 · 인라인 문자열)이고 세 번째는 또 5가지로 갈라진다. **런타임 `getComputedStyle` 전수 감사가 유일하게 경로-불변인 오라클이다.** 이번에 두 번의 "잔존 0" 선언이 모두 런타임 감사에 의해 반증됐다.

---

## 2. `chain-segment` 의 `7px solid transparent` = CSS 삼각형 기하, 선 규칙 **비대상** ⭐

```tsx
style={{ width: 0, height: 0,
         borderTop: '7px solid transparent',
         borderBottom: '7px solid transparent',
         borderLeft: `11px solid ${tipColor}` }}
```

`width/height: 0` + 투명 보더 = **화살촉을 그리는 고전 CSS 삼각형 트릭**이다. 보더처럼 생겼지만 "표면의 테두리"가 아니라 도형 자체의 기하값이다. "선은 전부 1px" 규칙을 기계적으로 적용하면 **화살촉이 사라진다**(체인 연결선의 방향 표시가 없어짐).

**판정 기준**: `width`/`height` 가 0 이고 보더 색에 `transparent` 가 섞여 있으면 기하다. 같은 착각이 재발하지 않게 **그 자리에 사유 주석을 남겼다.**

**같은 범주(지정값이라 1px 로 줄이지 않음)**: 체인 연결선 `borderTop: 1.5px` — CD 장면 01 이 "완료 1.5px ink 실선 · 진행 1.5px `--run-dot` · 대기 1.5px dashed" 로 **명시한 선 자체의 굵기**다. 테두리가 아니다.

---

## 3. 머지 후 삭제된 브랜치에 push 하면 **조용히 부활한다** — `[new branch]` 는 경보다 ⭐

**사건.** #1335 가 squash+delete-branch 로 머지된 직후 내가 마지막 수정 커밋을 push 했다. 성공했고, 출력은:

```
 * [new branch]        feat/rebrand-soft-stage2 -> feat/rebrand-soft-stage2
```

나는 이 문구를 확인하지 않았다. `[new branch]` = **origin 에 그 브랜치가 없었다** = 머지는 이미 끝났고 내 커밋은 **머지에 안 들어갔다**는 뜻이다. 동시에 삭제된 브랜치가 되살아났다.

**핵심: 성공 메시지와 구분이 안 되는 조용한 실패 경로다.** push 는 성공했고(exit 0), 브랜치는 존재하고, 커밋도 올라가 있다. 그런데 **PR 은 그 브랜치를 더 이상 보고 있지 않다**(이미 머지·닫힘) — 그래서 CI 도 안 돌고 리뷰에도 안 뜨고, 아무 경고가 없다. 커밋이 "어디에도 도달하지 않은" 상태가 성공처럼 보인다. 결과: main 에 `boxShadow: 'var(--)'` 와 `3px dashed` 가 남았고, 내가 PR 본문에 쓴 "두꺼운 보더 grep 0" 이 **main 기준으로 거짓**이 됐다.

**교훈.**
- push 결과 문구를 **읽어라.** 기존 브랜치면 `old..new`, 새 브랜치면 `* [new branch]`. 작업 중인 브랜치에서 후자가 나오면 **멈추고 머지 상태를 확인**해야 한다.
- 머지 직전/직후 구간에서는 `git log --oneline origin/main` + `git show origin/main:<파일>` 로 **내용이 실제로 들어갔는지** 확인한다. squash 는 커밋 ancestry 를 끊으므로 `--contains` 로는 판정 불가 — **내용 대조만 유효**하다.
- 조직 측 짝 교훈(writer 가 자기 몫으로 인정): "워커 최종 확인 회신을 요구했으면 **그 회신을 기다려서** 머지한다." in-flight 커밋 가능 구간에서 CLEAN 신호만으로 당기면 이 사고가 난다.

---

## 4. CSS 미니파이어 재인코딩이 토큰 대조에서 **거짓 불일치**로 뜬다

프리뷰 라이브 `getComputedStyle(:root)` 로 CD `tokens.css` 45개 토큰을 대조했을 때 7건이 불일치로 떴지만 **전부 값이 같았다**:

| 종류 | CD | 라이브 |
|---|---|---|
| named color 치환 | `#fffafa` | `snow` |
| hex 축약 | `#ffffff` | `#fff` |
| rgba → hex8 | `rgba(29,27,32,.04)` | `#1d1b200a` |

hex8 알파는 `round(.04 × 255) = 10 = 0x0a` 로 검산하면 일치가 확인된다(5개 값 전부 맞았다). **토큰 대조기는 문자열 비교가 아니라 색 파싱 후 비교여야 한다.** 그냥 비교하면 15%가 거짓 양성이 되어 진짜 불일치를 묻는다.

---

## 5. `globals.css` 캐스케이드가 "위젯 본문 외형"의 **본체**였다

작업 3(위젯 본문 7종)을 컴포넌트 레벨에서 전부 Soft 로 바꿨는데도 프리뷰에서 위젯 본문은 여전히 Memphis 였다. 원인:

```css
[data-canvas-body] button:not([data-canvas-action]) {
  border: 2.5px solid #000;  box-shadow: 3px3px0;  /* 컴포넌트의 border(1px)를 specificity 로 덮음 */
}
[data-canvas-body] :is(input, textarea, select) { border: 2px solid #000; }
```

컴포넌트 클래스에 `border`(1px)를 써도 computed 는 2~2.5px 검정이었다. **작업 3 은 컴포넌트 편집만으로 완결 불가**였고, 이 캐스케이드가 `--shadow-memphis-*` 를 참조하므로 **토큰 삭제와 같은 커밋이어야** 했다(토큰을 지우면 캐스케이드가 깨짐).

**교훈.** 전역 캐스케이드(`[data-*]` 스코프 룰)가 있는 레포에서 "컴포넌트를 다 바꿨다"는 완료 신호가 아니다. **먼저 `getComputedStyle` 로 한 샘플을 재어 보고** 어느 레이어가 최종 승자인지 확인한 뒤 작업 범위를 정하라. 이번엔 런타임 감사를 늦게 돌려서, 스펙 분해(3→4→5→6)가 한 번 재조정됐다.

---

## 6. 하드 오프셋 감지기는 **대각(x·y 둘 다 ≠0) + blur 0** 으로 판정해야 한다

첫 감사가 하드 오프셋 5건을 보고했는데 전부 오탐이었다 — CD 자신의 `--sh-card` 첫 겹이 `0 1px 0 rgba(…)` 이기 때문이다. `blur === 0 && (|x|>0 || |y|>0)` 로 느슨하게 잡으면 **CD 토큰을 위반으로 신고한다.** Memphis 시그니처는 대각 오프셋이다:

```js
if (blur === 0 && Math.abs(x) > 0.5 && Math.abs(y) > 0.5) → 하드 오프셋
```

---

## 7. 그 외 짧은 것들

- **중복 keyframe 합치기.** phase1 이 CD `sipulse` 와 동일 모션을 `palettePulse` 로 먼저 넣어 뒀다. 같은 모션을 두 번 정의하지 않고 **CD 이름으로 합치고** `.palette-pulse` + `.animate-sipulse` 가 공유하게 했다. 선행 PR 이 같은 것을 다른 이름으로 넣었는지 **rebase 후 먼저 확인**할 일.
- **소비처 없는 토큰은 등재하지 않는다.** CD 장면 02 의 `#d9e8fb`("열린 셋업 단계 테두리")는 이 레포 셋업 아코디언 3종이 borderless 구조라 **적용할 표면이 없었다.** 프레임 신설 = 레이아웃 무변경 제약 위반 + 장면 밖 구조 창작 → 사용자 상신. 토큰 선등재는 과잉이라 보류하고 사유를 주석에 남겼다 (CD 후속 질의 ③ 으로 승격됨).
- **Layer 2 는 삭제가 아니라 재지정.** `--border-strong`·`--canvas-card-*`·`--sidebar-*` 는 테마 swap 기계라, 삭제하면 `[data-theme]` 전환이 깨진다. Memphis **값**만 Soft 로 재지정하고 이름은 남겼다. 단 `--sidebar-border` 를 **글자색**으로 쓰던 4파일을 먼저 `--ink` 로 바꿨다 — 안 하면 1px 회색이 본문 글자색이 된다. **토큰을 재지정하기 전에 "색 역할"로 쓰이는 소비처를 먼저 분리**하라.
- **정규식이 클래스와 `var()` 참조를 구분해야 한다.** `re.sub(r'shadow-soft-card', '', line)` 가 `boxShadow: 'var(--shadow-soft-card)'` 를 `'var(--)'` 로 파손시켰다(2곳). 토큰명을 지울 때는 `var(--…)` 안쪽을 제외하는 lookbehind 가 필요하다.
- **`\b` 는 `]` 뒤에서 작동하지 않는다.** `\bborder-\[3px\]\b` 는 절대 매치되지 않는다(`]` 와 공백 모두 non-word → 경계 없음). bracket arbitrary value 를 다룰 때는 `(?![\w.\-])` lookahead 를 쓸 것. 이걸 모르고 첫 스윕에서 bracket 보더 300여 건을 조용히 놓쳤다.
- **사전 실패 테스트는 clean tree 에서 재현 확인하고 분류하라.** `pnpm test` 2건 실패를 발견했을 때 스태시 후 재실행해 **내 변경 전에도 실패**함을 확인했다. 이 한 단계가 "내가 깬 것"과 "원래 깨져 있던 것"을 가른다.
