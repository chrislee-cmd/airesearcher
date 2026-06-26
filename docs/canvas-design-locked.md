# /canvas — Locked Design (2026-06-25, production applied 2026-06-26)

> 사용자가 PR #403 6-dimension switcher 비교 끝에 잠근 조합.
> 이 디자인은 main 의 `/canvas` 라우트에 적용 (PR-D2 재정의) —
> switcher / 다른 variant / 비교 인프라 없이 잠금 조합 1개만.
> PR #403 자체는 production 머지 X (adhoc 비교 인프라 포함).
> **PR-D3 (2026-06-26)**: 글로벌 shell (사이드바 + topbar) 도 pop 톤 (chrome only) 적용 — `--color-pop-*` / `--shadow-pop-*` / `--font-pop` 토큰 추가. 메뉴 항목 / topbar 컨텐츠 / 다른 라우트 본문은 영향 0.
> **PR-D4 (2026-06-26)**: shell internals (사이드바 nav item / 그룹 헤더 / sidebar-account 카드 / topbar 내부 컨텐츠) 까지 pop 톤 적용. `data-shell-*` attribute 로 scope — 다른 라우트 본문 영향 0. D3 의 chrome + D4 의 internals = 사이드바/헤더 완전 deprecate-and-redesign.

## 잠근 조합

| dimension   | 값                | 의미 |
|---|---|---|
| theme       | `pop`             | Neo-Memphis: 노랑 bg + 3px 검은 border + 6px offset shadow + 핑크 액센트 |
| font        | `outfit`          | Outfit — geometric sans, modern, weight 600~700 |
| layout      | `banner-top`      | 큰 컬러 hero 헤더 (140px) + 본문 영역 |
| panel       | `framed`          | 본문에 2.5px 검은 inner frame + inset shadow (액자 / mat) |
| interior    | `bold`            | Memphis component: button/input 에 2.5px 검은 border + 3px offset shadow |
| typography  | `display`         | 헤딩 26-32px / weight 800 / tight tracking -0.02em / line 1.1 |

**URL**: `/canvas` (param 없음) → 이 조합 자동 적용.
**override**: `?theme=cyber` 등 query 로 다른 variant 진입 가능 (switcher 와 동일).

## 핵심 시각 토큰 (이 조합 한정)

### 캔버스 chrome (`[data-canvas-theme="pop"]`, `src/app/globals.css`)
```css
--canvas-bg: #fffce1;
--canvas-bg-image: radial-gradient(circle, rgba(0,0,0,0.18) 2px, transparent 2px);
--canvas-bg-size: 32px 32px;
--canvas-card-bg: #ffffff;
--canvas-card-border: #000000;
--canvas-card-border-width: 3px;
--canvas-card-radius: 14px;
--canvas-card-shadow: 6px 6px 0 #000000;
--canvas-accent: #ff5c8a;
--canvas-edge: #000000;
--canvas-edge-live: #ff5c8a;
--canvas-edge-width: 3px;
--canvas-chrome-bg: #ffffff;
--canvas-chrome-border: #000000;
--canvas-chrome-shadow: 4px 4px 0 #000000;
--canvas-selection-border: #ff5c8a;
```

### 헤더 폰트 (`outfit`, `src/lib/canvas/themes.ts`)
```ts
{ key: 'outfit', label: 'Outfit', family: 'var(--font-outfit), var(--font-sans)' }
```
`canvas-board` 가 inline style 로 `--canvas-card-header-font` 주입.

### Banner-top layout (`src/components/canvas/shell/widget-shell.tsx`)
- 헤더 높이 = 140px (collapsed 시 64px)
- 헤더 bg = pop 노랑 `#ffd53d`
- 헤더 text color = `#000`
- 헤더 border-bottom = 3px solid `#000`
- 헤더에 label (32px) + 상단 작은 줄 (cost · state pill · chevron)
- 본문 = 카드 영역 580px (확장 시)

### Framed panel (CSS rule)
```jsx
<div className="min-h-0 flex-1 overflow-y-auto bg-paper p-3">
  <div style={{
    border: '2.5px solid #000',
    borderRadius: 6,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6), inset 0 2px 6px rgba(0,0,0,0.05)',
  }}>
    {ExpandedBody}
  </div>
</div>
```

### Bold interior (CSS scoped — `[data-canvas-interior="bold"] [data-canvas-body]`)
```css
button {
  border: 2.5px solid #000;
  border-radius: 8px;
  background: #fff;
  color: #000;
  font-weight: 700;
  box-shadow: 3px 3px 0 #000;
  padding: 0.4rem 0.85rem;
}
button:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 #000; }
button:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #000; }
:is(input, textarea, select) {
  border: 2px solid #000;
  border-radius: 6px;
  background: #fff;
  color: #000;
  padding: 0.5rem 0.75rem;
}
:is(input, textarea, select):focus { outline: 3px solid #ff5c8a; outline-offset: 2px; }
```

### Display typography (CSS scoped — `[data-canvas-typography="display"] [data-canvas-body]`)
```css
:is(h1, h2, h3, .text-xl, .text-2xl, .text-3xl, .text-display) {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
:is(h1, .text-3xl, .text-display) { font-size: 32px; }
```

## 파일 위치 reference

| 파일 | 책임 |
|---|---|
| `src/lib/canvas/themes.ts` | 6 dimension enum + meta + URL helper |
| `src/app/globals.css` | `[data-canvas-theme]` / `-interior` / `-typography` CSS rule |
| `src/app/[locale]/(app)/canvas/layout.tsx` | 23 폰트 `next/font/google` import + CSS variable wire |
| `src/app/[locale]/(app)/canvas/page.tsx` | searchParams 읽고 잠근 default 로 fallback |
| `src/app/[locale]/(app)/canvas/canvas-board.tsx` | state + data attribute + 6 prop 전달 |
| `src/components/canvas/shell/widget-shell.tsx` | 5 layout dispatch + PanelMain/PanelFooter + theme 시그너처 |
| `src/components/canvas/canvas-theme-switcher.tsx` | 좌상단 6행 switcher |
| `src/components/canvas/canvas-edges.tsx` | SVG bezier edge (theme 색 / dash / glow) |
| `src/components/canvas/canvas-toolbar.tsx` | 하단 floating 툴바 (theme chrome) |
| `src/components/canvas/canvas-minimap.tsx` | 우상단 minimap (theme chrome) |
| `src/lib/canvas/graph.ts` | 노드 기본 위치 + edge SSOT |

## 다음 PR 후보 (spec writer 결정)

- [ ] switcher 비교 UI 제거 (잠금 후 production cleanup)
- [ ] 다른 5 theme / 다른 4 layout / 다른 4 panel / 다른 4 interior /
      다른 4 typography 의 CSS / 컴포넌트 분기 코드 제거 (dead code)
- [ ] /canvas 외 인앱 라우트 (dashboard / quotes / desk 등) 에 pop 톤
      적용 여부 결정
- [ ] 랜딩 (`/`) 은 분리 유지 (PR-D8 자리 보존)
- [ ] design-system catalog 페이지 (`/design-system`) 에 pop / banner-top /
      framed / bold 패턴 등록
- [ ] 위젯 본문 (ExpandedBody) 의 마크업 / Tailwind 클래스도 새 톤에 맞게
      review (현재는 CSS layer 만 override — h1/h2 가 없는 위젯은 미적용)
- [ ] 사이드바 / 헤더 / 라우트 chrome redesign (D3 자리)
