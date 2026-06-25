# Design System v3 — 노션 베이스 + n8n 캔버스 elevation (Draft)

> **상태**: PR-D1 (토큰 교체) 와 함께 도입. 후속 PR (D2~D7) 에서 primitive / shell / 페이지 디테일 다듬음. v2 draft 의 editorial + bento hybrid 방향은 superseded.
>
> **결정 배경**: 사용자 요청 — "전체 서비스 디자인 완전히 리워크 — 지금보다 훨씬 더 노션스러운 ui 와 전체적인 디자인 스타일을 추구". n8n 풍도 OK.

---

## 1. 톤 정합

| 측면 | 결정 | 이유 |
|---|---|---|
| Base tone | **노션** (클린, 미니멀, 컨텐츠 우선) | 사용자 요청 1순위 |
| Canvas / 위젯 영역 | **n8n** 풍 subtle elevation 보존 — `/canvas` 같은 노드/위젯 면에서 카드가 살짝 떠 보이게 | n8n 의 캔버스가 강점인 영역 |
| 마케팅 / 랜딩 | **인앱 SSOT 와 분리** — `/`, `/affinity-bubble` 등은 bento 톤 유지 (PR-D8 별 결정) | v2 draft 의 라우트 단위 톤 분리 원칙 보존 + PR-3 폐기 학습 (스코프 폭주) |

---

## 2. 적용 범위 (PR-D1)

- **인앱 (인앱 라우트 전체)**: `/dashboard`, `/canvas`, `/quotes`, `/desk`, `/projects`, `/recruiting`, `/interviews`, `/transcripts`, `/live`, `/credits`, `/members`, `/settings`, `/insights-analyzer`, `/analyzer`, `/keywords`, `/moderator`, `/quant`, `/reports`, `/scheduler`, `/slidegen`, `/survey`, `/video`, `/design-system`, `/affinity-bubble`
- **변경 단위**: 토큰 값만. 이름은 유지 (`bg-paper`, `text-ink-2`, `border-line`, `bg-amore` 등 198곳 자동 반영)
- **이 PR 범위 밖**: primitive 시각 디테일 (radius / hover / focus ring) → D2, 사이드바·헤더 redesign → D3, 페이지별 layout 재구성 → D4~D7, 랜딩/마케팅 → D8 (보류)

---

## 3. 토큰 값 (globals.css `@theme`)

### 3.1 색상 (Before → After)

| token | before | after | 메모 |
|---|---|---|---|
| `--color-paper` | `#fbf7f2` (warm cream) | `#FFFFFF` (pure white) | 노션 in-app 페이지 배경 |
| `--color-paper-soft` | `#fefaf5` | `#F7F7F5` | 노션 panel grey — 카드 surface, zebra |
| `--color-ink` | `#1d1b20` | `#37352F` | 노션 본문 다크 grey |
| `--color-ink-2` | `#2a262f` | `#37352F` | 본문 기본 — 노션은 ink/ink-2 거의 동일 |
| `--color-mute` | `#5b5965` | `#787774` | 노션 보조 회색 |
| `--color-mute-soft` | `#8a8693` | `#9B9A97` | 노션 캡션/helper |
| `--color-line` | `rgba(29,27,32,0.10)` | `rgba(55,53,47,0.09)` | 노션 hairline (1px) — 더 미묘 |
| `--color-line-soft` | `rgba(29,27,32,0.06)` | `rgba(55,53,47,0.055)` | 약한 구분선 |
| `--color-amore` | `#a06fda` (보라) | `#2EAADC` (노션 블루) | primary accent |
| `--color-amore-soft` | `#b690e2` | `#5BBEE3` | hover/active |
| `--color-amore-bg` | `#e7defe` | `#D3EDF8` | wash 면 |
| `--color-amore-tint` | `#d6c3fb` | `#A5DBED` | 카드 헤더 포인트 |
| `--color-pacific` | `#1d1b20` | `#37352F` | ink 별칭 — 자동 정합 |
| `--color-pacific-bg` | `#f3f0eb` | `#F1F1EF` | 태그 배경 — 노션 grey tint |

### 3.2 Pastel — 데이터 시각화용 보존

| token | 값 | 정합 |
|---|---|---|
| `--color-lav` | `#D3EDF8` (이전 `#e7defe`) | amore-bg 와 일치 (블루 wash) — primary highlight |
| `--color-peach` | `#ffd9c9` (변경 X) | secondary |
| `--color-mint` | `#cdebd9` (변경 X) | positive |
| `--color-sun` | `#fff1b6` (변경 X) | 형광펜 highlight |
| `--color-sky` | `#cfe6ff` (변경 X) | info |
| `--color-rose` | `#ffd0e2` (변경 X) | external |

> 노션도 데이터 시각화 (차트, 캘린더 컬러 라벨) 에선 컬러풀. 파스텔 6개는 시그널 / 컬러 라벨 용도라 유지.

### 3.3 Radius

| token | before | after | 메모 |
|---|---|---|---|
| `--radius-xs` | `4px` | `4px` (변경 X) | 작은 input 등 |
| `--radius-sm` | `14px` | `6px` | 카드 기본 — 노션식 |
| `--radius-md` | `24px` | `10px` | 큰 컨테이너 |
| `--radius-lg` | `32px` | `14px` | hero / 큰 surface (n8n 캔버스 영역) |
| `--radius-pill` | `999px` | `999px` (변경 X) | |

### 3.4 Shadow

- `--shadow-bento`: `0 1px 2px rgba(55,53,47,0.03), 0 4px 12px rgba(55,53,47,0.04)` (n8n elevation 보다 살짝 lighter)
- 노션 본체는 shadow 거의 0 — 캔버스/위젯 영역만 shadow 살림. primitive 단위 적용은 D2.

### 3.5 Typography / 시그널 — 변경 X

- `--font-sans` Pretendard 유지
- font-size scale, font-weight 패턴 변경 X (D2 에서 다듬음)
- `--color-success/warning/warning-bg/warning-line`, `--color-am-accent/pm-accent` 변경 X

---

## 4. 후속 PR 시퀀스 (의도 명시)

| PR | 범위 |
|---|---|
| D1 (이번) | globals.css 토큰 값 교체 — 인앱 자동 정합 |
| D2 | Primitive 시각 디테일 (Button radius / hover / focus ring 정리, eyebrow / UPPERCASE 라벨 retire 검토) |
| D3 | 사이드바 / 헤더 / 라우트 chrome redesign |
| D4~D7 | 페이지별 layout 재구성 (dashboard / canvas / interviews / 그 외) |
| D8 (보류) | 랜딩 / 마케팅 면 — bento 유지 또는 별 정합 결정 |

> 다크 모드는 별도 큰 PR 후보 — v3 의 token alias 구조를 그대로 dark theme 매핑으로 확장 가능.
