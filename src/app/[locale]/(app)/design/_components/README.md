# `/design/*` — 디자인 시스템 비교 하네스

bento (현재 ai-researcher 톤) vs 다른 레퍼런스 시스템 (airbnb, apple, claude, cursor, ...) 을 같은 컴포넌트 셋으로 나란히 렌더해서 시각적으로 비교하기 위한 실험 경로입니다.

## 라우트

- `/{locale}/design/airbnb` — bento (좌) vs airbnb (우) split view

후속 PR 에서 `/design/<system>` 페이지가 같은 패턴으로 추가됩니다.

## 동작 방식 — 1줄로

`globals.css` 의 `@theme {}` 안에 정의된 bento CSS 변수 (`--color-amore`, `--color-ink`, `--color-line`, `--color-paper`, `--radius-sm`, `--radius-md`, `--font-sans` 등) 를, `[data-design="<system>"]` 셀렉터 안에서 해당 디자인 시스템 값으로 **오버라이드** 합니다. JSX 는 그대로 두고 wrapper `data-design` 만 바꾸면 같은 클래스 (`bg-amore`, `border-line`, `rounded-sm` …) 가 새 톤으로 렌더됩니다.

## 새 디자인 시스템 추가 절차

1. `jarvis/design-system/DESIGN-<name>.md` 의 frontmatter 를 SSOT 로 사용. 값 임의 보간 금지.
2. `src/app/globals.css` 끝에 `[data-design="<name>"]` 블록 추가. bento 토큰 이름 (`--color-amore`, `--color-ink`, `--color-line`, `--color-paper-*`, `--color-pacific*`, `--color-mute*`, `--color-ink-2`, `--color-gray-warm`, `--radius-{xs,sm,md,lg,pill}`, `--font-sans`, `--shadow-bento`) 을 오버라이드. 시스템 고유 토큰 (예: airbnb 의 luxe/plus) 은 `--color-<name>-<role>` 로 신규 추가.
3. `src/app/[locale]/(app)/design/<name>/page.tsx` 추가 — 본 디렉토리의 `airbnb/page.tsx` 를 그대로 복사하고 `data-design`, `systemLabel`, `tagline` 만 교체.
4. (선택) 시스템 고유 컴포넌트 demo 가 필요하면 `_components/` 에 `<name>-extra.tsx` 추가하고 페이지 우측에 끼움.

## SampleCluster — 비교 컴포넌트 셋

`_components/sample-cluster.tsx` 에 정의. 동일한 prop 으로 양쪽에 렌더되고, 각 row 는 토큰의 한 가지 측면을 시각화합니다:

| Row | 시각화 토큰 |
|---|---|
| Buttons | `--color-amore` (primary), `--color-ink` (secondary), `--radius-sm`, `--radius-pill` |
| Search bar | `--radius-pill`, `--color-line`, `--shadow-bento`, search orb 의 `--color-amore` |
| Property card | `--radius-md`, `--color-paper`, `--shadow-bento`, badge |
| Inputs | `--radius-sm`, `--color-line` → `--color-ink` (focus) |
| Rating | `--text-display`, `--color-amore` (accent dot) |

새 row 가 필요하면 같은 패턴으로 추가. 비교의 핵심은 **JSX 하나에 두 디자인을 입혀서 동등 비교**하는 것 — 시스템 별 전용 컴포넌트가 필요하면 비교 외 자리 (페이지 우측 등) 에 분리해서 둡니다.

## 제약

- bento 토큰 값 무변경. `[data-design]` 블록 외부 (`@theme {}`) 는 절대 수정 금지.
- 기존 컴포넌트 (`src/components/ui/*`, recruiting-card, interview-* 등) 수정 금지. SampleCluster 는 raw `<button>/<input>` 을 사용해서 토큰 오버라이드 효과를 시각화 — 이 디렉토리는 `eslint.config.mjs` 의 native-control 가드에서 예외 처리되어 있습니다.
- 폰트 파일 추가 금지 — Airbnb Cereal VF 같은 라이선스 폰트는 fontFamily 만 선언하고 system fallback 으로 표시.

## 알려진 한계

- (app) 그룹 안에 있어 사이드바가 옆에 같이 렌더됩니다. main 영역 안에서 2-column split 으로 비교합니다. 전체 화면 비교가 필요하면 후속 PR 에서 `(design-lab)` 사이블링 route group 으로 이동.
