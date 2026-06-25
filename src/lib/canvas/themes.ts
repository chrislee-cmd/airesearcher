/* ────────────────────────────────────────────────────────────────────
   Canvas theme SSOT — /canvas 페이지 한정 시각 variant.

   - theme: 카드 chrome / 배경 / 색 / radius (globals.css 의
     [data-canvas-theme="<key>"] 스코프 CSS variable override).
   - font: 헤더 폰트 — 각 theme 별로 personality 살짝 다른 5개.
     next/font/google 으로 layout 에서 import → CSS variable.
     활성 폰트는 canvas-board 가 container inline style 로
     --canvas-card-header-font 를 override.
   - URL ?theme=<key>&font=<key> 동기화 → 새로고침 시 유지.
   ──────────────────────────────────────────────────────────────────── */

export type CanvasTheme = 'default' | 'cyber' | 'glass' | 'swiss' | 'sketch' | 'pop';

export type FontVariant = {
  key: string;       // URL-safe slug
  label: string;     // UI 표시명
  // CSS font-family value — next/font 가 만든 var 또는 system font stack.
  // canvas-board 가 inline style 로 --canvas-card-header-font 에 주입.
  family: string;
};

export type ThemeMeta = {
  key: CanvasTheme;
  label: string;
  hint: string;
  fonts: FontVariant[]; // 첫 번째 = default
};

// fallback chain — 폰트 미로딩 / 한국어 미지원 시 Pretendard 로 떨어짐.
const KO_FALLBACK = ', var(--font-sans)';
const MONO_FALLBACK = ', ui-monospace, "SF Mono", Menlo, monospace';
const SERIF_FALLBACK = ', "Iowan Old Style", "Apple Garamond", serif';
const CURSIVE_FALLBACK = ', "Caveat", cursive';

export const CANVAS_THEMES: ThemeMeta[] = [
  {
    key: 'default',
    label: 'Notion',
    hint: '클린 베이스 (현재)',
    fonts: [
      { key: 'pretendard', label: 'Pretendard',       family: 'var(--font-sans)' },
      { key: 'inter',      label: 'Inter',            family: 'var(--font-inter)' + KO_FALLBACK },
      { key: 'geist',      label: 'Geist',            family: 'var(--font-geist)' + KO_FALLBACK },
      { key: 'manrope',    label: 'Manrope',          family: 'var(--font-manrope)' + KO_FALLBACK },
      { key: 'instrument', label: 'Instrument Serif', family: 'var(--font-instrument-serif)' + SERIF_FALLBACK + KO_FALLBACK },
    ],
  },
  {
    key: 'cyber',
    label: 'Cyber',
    hint: '다크 터미널 + 모노스페이스',
    fonts: [
      { key: 'jetbrains',  label: 'JetBrains Mono', family: 'var(--font-jetbrains-mono)' + MONO_FALLBACK + KO_FALLBACK },
      { key: 'ibmplex',    label: 'IBM Plex Mono',  family: 'var(--font-ibm-plex-mono)' + MONO_FALLBACK + KO_FALLBACK },
      { key: 'geistmono',  label: 'Geist Mono',     family: 'var(--font-geist-mono)' + MONO_FALLBACK + KO_FALLBACK },
      { key: 'spacemono',  label: 'Space Mono',     family: 'var(--font-space-mono)' + MONO_FALLBACK + KO_FALLBACK },
      { key: 'vt323',      label: 'VT323',          family: 'var(--font-vt323)' + MONO_FALLBACK + KO_FALLBACK },
    ],
  },
  {
    key: 'glass',
    label: 'Glass',
    hint: 'Vision Pro frosted',
    fonts: [
      { key: 'inter',         label: 'Inter',         family: 'var(--font-inter)' + KO_FALLBACK },
      { key: 'sf',            label: 'SF Pro',        family: '-apple-system, "SF Pro Display", BlinkMacSystemFont' + KO_FALLBACK },
      { key: 'manrope',       label: 'Manrope',       family: 'var(--font-manrope)' + KO_FALLBACK },
      { key: 'geist',         label: 'Geist',         family: 'var(--font-geist)' + KO_FALLBACK },
      { key: 'plusjakarta',   label: 'Plus Jakarta',  family: 'var(--font-plus-jakarta-sans)' + KO_FALLBACK },
    ],
  },
  {
    key: 'swiss',
    label: 'Swiss',
    hint: '흑백 brutalist',
    fonts: [
      { key: 'intertight', label: 'Inter Tight',     family: 'var(--font-inter-tight)' + KO_FALLBACK },
      { key: 'helvetica',  label: 'Helvetica Neue',  family: '"Helvetica Neue", Helvetica, Arial' + KO_FALLBACK },
      { key: 'archivo',    label: 'Archivo',         family: 'var(--font-archivo)' + KO_FALLBACK },
      { key: 'outfit',     label: 'Outfit',          family: 'var(--font-outfit)' + KO_FALLBACK },
      { key: 'albert',     label: 'Albert Sans',     family: 'var(--font-albert-sans)' + KO_FALLBACK },
    ],
  },
  {
    key: 'sketch',
    label: 'Sketch',
    hint: '손그림 노트',
    fonts: [
      { key: 'caveat',     label: 'Caveat',              family: 'var(--font-caveat)' + CURSIVE_FALLBACK + KO_FALLBACK },
      { key: 'architects', label: 'Architects Daughter', family: 'var(--font-architects-daughter)' + CURSIVE_FALLBACK + KO_FALLBACK },
      { key: 'patrick',    label: 'Patrick Hand',        family: 'var(--font-patrick-hand)' + CURSIVE_FALLBACK + KO_FALLBACK },
      { key: 'shadows',    label: 'Shadows Into Light',  family: 'var(--font-shadows-into-light)' + CURSIVE_FALLBACK + KO_FALLBACK },
      { key: 'kalam',      label: 'Kalam',               family: 'var(--font-kalam)' + CURSIVE_FALLBACK + KO_FALLBACK },
    ],
  },
  {
    key: 'pop',
    label: 'Pop',
    hint: 'Neo-Memphis 팝',
    fonts: [
      { key: 'spacegrotesk', label: 'Space Grotesk',       family: 'var(--font-space-grotesk)' + KO_FALLBACK },
      { key: 'bricolage',    label: 'Bricolage Grotesque', family: 'var(--font-bricolage-grotesque)' + KO_FALLBACK },
      { key: 'bagel',        label: 'Bagel Fat One',       family: 'var(--font-bagel-fat-one)' + KO_FALLBACK },
      { key: 'dmserif',      label: 'DM Serif Display',    family: 'var(--font-dm-serif-display)' + SERIF_FALLBACK + KO_FALLBACK },
      { key: 'outfit',       label: 'Outfit',              family: 'var(--font-outfit)' + KO_FALLBACK },
    ],
  },
];

const THEME_BY_KEY = Object.fromEntries(CANVAS_THEMES.map((t) => [t.key, t]));

export function asCanvasTheme(input: unknown): CanvasTheme {
  if (typeof input === 'string' && input in THEME_BY_KEY) return input as CanvasTheme;
  return 'default';
}

export function getThemeMeta(theme: CanvasTheme): ThemeMeta {
  return THEME_BY_KEY[theme]!;
}

export function asFontKey(theme: CanvasTheme, fontKey: unknown): string {
  const meta = getThemeMeta(theme);
  if (typeof fontKey === 'string' && meta.fonts.some((f) => f.key === fontKey)) return fontKey;
  return meta.fonts[0].key;
}

export function resolveFont(theme: CanvasTheme, fontKey: string): FontVariant {
  const meta = getThemeMeta(theme);
  return meta.fonts.find((f) => f.key === fontKey) ?? meta.fonts[0];
}

/* ────────────────────────────────────────────────────────────────────
   Widget layout — 노드 카드 자체의 구조 variant.
   theme/font 와 독립적인 dimension — pop + outfit 위에서도, default 위에서도
   동일하게 작동. 5개 시각 paradigm:
     classic       — 상단 헤더 + 본문 가득 (기존)
     banner-top    — 큰 컬러 hero 헤더 (label 크게) + 본문 60%
     banner-bottom — 본문 dominant + 하단 caption frame (Polaroid)
     sidebar       — 좌측 세로 strip (icon/state) + 우측 본문
     sticker       — 헤더 chrome 제거 + 카드 밖에 떠 있는 sticker label
                     + 살짝 기울기
   ──────────────────────────────────────────────────────────────────── */

export type WidgetLayout =
  | 'classic'
  | 'banner-top'
  | 'banner-bottom'
  | 'sidebar'
  | 'sticker';

export const WIDGET_LAYOUTS: { key: WidgetLayout; label: string; hint: string }[] = [
  { key: 'classic',       label: 'Classic',  hint: '상단 헤더 + 본문 (현재)' },
  { key: 'banner-top',    label: 'Banner',   hint: '큰 컬러 hero 헤더' },
  { key: 'banner-bottom', label: 'Polaroid', hint: '하단 caption (사진처럼)' },
  { key: 'sidebar',       label: 'Sidebar',  hint: '좌측 세로 strip + 본문' },
  { key: 'sticker',       label: 'Sticker',  hint: '떠 있는 라벨 + 기울기' },
];

const LAYOUT_KEYS = new Set<string>(WIDGET_LAYOUTS.map((l) => l.key));

export function asWidgetLayout(input: unknown): WidgetLayout {
  if (typeof input === 'string' && LAYOUT_KEYS.has(input)) return input as WidgetLayout;
  return 'classic';
}

/* ────────────────────────────────────────────────────────────────────
   Widget panel — main 본문 + footer 의 visual treatment.
   layout (헤더 구조) 과 별도 dimension. layout × panel = 25 조합 가능.

     plain         — 본문만 (현재). footer 없음.
     framed        — 본문에 inner frame border + inset shadow (mat 느낌).
     strip-footer  — 하단 컬러 strip footer (state + cost).
     cta-footer    — 하단 큰 CTA 버튼 footer ("도구 열기").
     receipt       — 본문 아래 dashed divider + monospace 영수증 lines.

   ExpandedBody 자체는 안 건드림 — 그 주변 frame / footer 만 panel 별로.
   ──────────────────────────────────────────────────────────────────── */

export type WidgetPanel = 'plain' | 'framed' | 'strip-footer' | 'cta-footer' | 'receipt';

export const WIDGET_PANELS: { key: WidgetPanel; label: string; hint: string }[] = [
  { key: 'plain',        label: 'Plain',   hint: '본문만 (현재)' },
  { key: 'framed',       label: 'Framed',  hint: '본문 inner frame + inset shadow' },
  { key: 'strip-footer', label: 'Strip',   hint: '하단 컬러 strip footer' },
  { key: 'cta-footer',   label: 'CTA',     hint: '하단 큰 액션 버튼 footer' },
  { key: 'receipt',      label: 'Receipt', hint: '본문 아래 영수증 라인' },
];

const PANEL_KEYS = new Set<string>(WIDGET_PANELS.map((p) => p.key));

export function asWidgetPanel(input: unknown): WidgetPanel {
  if (typeof input === 'string' && PANEL_KEYS.has(input)) return input as WidgetPanel;
  return 'plain';
}

/* ────────────────────────────────────────────────────────────────────
   Widget interior — 패널 안 (ExpandedBody) 의 component/token 레이어.
   CSS scoped override — [data-canvas-interior="<key>"] [data-canvas-body]
   안에서 button / input / select / textarea 의 외관을 통째로 교체.

     default   — override 없음 (글로벌 primitive 그대로)
     bold      — Memphis: 굵은 검은 border + offset shadow (pop 매칭)
     outlined  — outline-only, hover 시 fill
     pill      — rounded-full + 부드러운 bg hover
     paper     — button = text link, input = 하단 border-only (minimal)

   ExpandedBody 자체 코드는 zero touch — CSS 한 layer 만.
   다른 라우트 / canvas chrome (toolbar/switcher/minimap) 영향 X
   ([data-canvas-body] 가 PanelMain 의 widget body 안에만 존재).
   ──────────────────────────────────────────────────────────────────── */

export type WidgetInterior = 'default' | 'bold' | 'outlined' | 'pill' | 'paper';

export const WIDGET_INTERIORS: { key: WidgetInterior; label: string; hint: string }[] = [
  { key: 'default',  label: 'Default',  hint: '글로벌 primitive (현재)' },
  { key: 'bold',     label: 'Bold',     hint: 'Memphis 검은 border + offset shadow' },
  { key: 'outlined', label: 'Outlined', hint: 'outline-only, hover 시 fill' },
  { key: 'pill',     label: 'Pill',     hint: 'rounded-full + 부드러운 hover' },
  { key: 'paper',    label: 'Paper',    hint: 'text link + underline 입력 (minimal)' },
];

const INTERIOR_KEYS = new Set<string>(WIDGET_INTERIORS.map((i) => i.key));

export function asWidgetInterior(input: unknown): WidgetInterior {
  if (typeof input === 'string' && INTERIOR_KEYS.has(input)) return input as WidgetInterior;
  return 'default';
}
