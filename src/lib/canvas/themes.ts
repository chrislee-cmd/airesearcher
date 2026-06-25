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
