/* ────────────────────────────────────────────────────────────────────
   Canvas theme SSOT — /canvas 페이지 한정 시각 variant.

   6 dimension × ~10 variant each:
     theme       (11) — globals.css 의 [data-canvas-theme=X] 스코프 CSS variable
     font        (10 per theme) — next/font/google preload + family stack
     layout      (10) — widget-shell 의 5 더 추가
     panel       (10) — PanelMain/Footer 의 5 더 추가
     interior    (10) — globals.css 의 [data-canvas-interior=X] CSS
     typography  (10) — globals.css 의 [data-canvas-typography=X] CSS
   ──────────────────────────────────────────────────────────────────── */

export type CanvasTheme =
  | 'default'
  | 'cyber'
  | 'glass'
  | 'swiss'
  | 'sketch'
  | 'pop'
  | 'mocha'
  | 'synthwave'
  | 'risograph'
  | 'blueprint'
  | 'pastel';

export type FontVariant = {
  key: string;
  label: string;
  family: string;
};

export type ThemeMeta = {
  key: CanvasTheme;
  label: string;
  hint: string;
  fonts: FontVariant[]; // 첫 번째 = default
};

const KO_FALLBACK = ', var(--font-sans)';
const MONO_FALLBACK = ', ui-monospace, "SF Mono", Menlo, monospace';
const SERIF_FALLBACK = ', "Iowan Old Style", "Apple Garamond", serif';
const CURSIVE_FALLBACK = ', "Caveat", cursive';

// helper — 폰트 family string 생성 (KO fallback 자동 append).
const sansVar = (v: string) => `var(--font-${v})${KO_FALLBACK}`;
const monoVar = (v: string) => `var(--font-${v})${MONO_FALLBACK}${KO_FALLBACK}`;
const serifVar = (v: string) => `var(--font-${v})${SERIF_FALLBACK}${KO_FALLBACK}`;
const cursiveVar = (v: string) => `var(--font-${v})${CURSIVE_FALLBACK}${KO_FALLBACK}`;

export const CANVAS_THEMES: ThemeMeta[] = [
  {
    key: 'default',
    label: 'Notion',
    hint: '클린 베이스',
    fonts: [
      { key: 'pretendard', label: 'Pretendard',       family: 'var(--font-sans)' },
      { key: 'inter',      label: 'Inter',            family: sansVar('inter') },
      { key: 'geist',      label: 'Geist',            family: sansVar('geist') },
      { key: 'manrope',    label: 'Manrope',          family: sansVar('manrope') },
      { key: 'instrument', label: 'Instrument Serif', family: serifVar('instrument-serif') },
      { key: 'dmsans',     label: 'DM Sans',          family: sansVar('dm-sans') },
      { key: 'lexend',     label: 'Lexend',           family: sansVar('lexend') },
      { key: 'sora',       label: 'Sora',             family: sansVar('sora') },
      { key: 'publicsans', label: 'Public Sans',      family: sansVar('public-sans') },
      { key: 'worksans',   label: 'Work Sans',        family: sansVar('work-sans') },
    ],
  },
  {
    key: 'cyber',
    label: 'Cyber',
    hint: '다크 터미널 + 모노스페이스',
    fonts: [
      { key: 'jetbrains',  label: 'JetBrains Mono',   family: monoVar('jetbrains-mono') },
      { key: 'ibmplex',    label: 'IBM Plex Mono',    family: monoVar('ibm-plex-mono') },
      { key: 'geistmono',  label: 'Geist Mono',       family: monoVar('geist-mono') },
      { key: 'spacemono',  label: 'Space Mono',       family: monoVar('space-mono') },
      { key: 'vt323',      label: 'VT323',            family: monoVar('vt323') },
      { key: 'firacode',   label: 'Fira Code',        family: monoVar('fira-code') },
      { key: 'robotomono', label: 'Roboto Mono',      family: monoVar('roboto-mono') },
      { key: 'sourcecode', label: 'Source Code Pro',  family: monoVar('source-code-pro') },
      { key: 'cutive',     label: 'Cutive Mono',      family: monoVar('cutive-mono') },
      { key: 'sharetech',  label: 'Share Tech Mono',  family: monoVar('share-tech-mono') },
    ],
  },
  {
    key: 'glass',
    label: 'Glass',
    hint: 'Vision Pro frosted',
    fonts: [
      { key: 'inter',         label: 'Inter',         family: sansVar('inter') },
      { key: 'sf',            label: 'SF Pro',        family: '-apple-system, "SF Pro Display", BlinkMacSystemFont' + KO_FALLBACK },
      { key: 'manrope',       label: 'Manrope',       family: sansVar('manrope') },
      { key: 'geist',         label: 'Geist',         family: sansVar('geist') },
      { key: 'plusjakarta',   label: 'Plus Jakarta',  family: sansVar('plus-jakarta-sans') },
      { key: 'outfit',        label: 'Outfit',        family: sansVar('outfit') },
      { key: 'dmsans',        label: 'DM Sans',       family: sansVar('dm-sans') },
      { key: 'albert',        label: 'Albert Sans',   family: sansVar('albert-sans') },
      { key: 'bevietnam',     label: 'Be Vietnam Pro', family: sansVar('be-vietnam-pro') },
      { key: 'nunito',        label: 'Nunito',        family: sansVar('nunito') },
    ],
  },
  {
    key: 'swiss',
    label: 'Swiss',
    hint: '흑백 brutalist',
    fonts: [
      { key: 'intertight', label: 'Inter Tight',     family: sansVar('inter-tight') },
      { key: 'helvetica',  label: 'Helvetica Neue',  family: '"Helvetica Neue", Helvetica, Arial' + KO_FALLBACK },
      { key: 'archivo',    label: 'Archivo',         family: sansVar('archivo') },
      { key: 'outfit',     label: 'Outfit',          family: sansVar('outfit') },
      { key: 'albert',     label: 'Albert Sans',     family: sansVar('albert-sans') },
      { key: 'roboto',     label: 'Roboto',          family: sansVar('roboto') },
      { key: 'ibmsans',    label: 'IBM Plex Sans',   family: sansVar('ibm-plex-sans') },
      { key: 'worksans',   label: 'Work Sans',       family: sansVar('work-sans') },
      { key: 'publicsans', label: 'Public Sans',     family: sansVar('public-sans') },
      { key: 'sora',       label: 'Sora',            family: sansVar('sora') },
    ],
  },
  {
    key: 'sketch',
    label: 'Sketch',
    hint: '손그림 노트',
    fonts: [
      { key: 'caveat',     label: 'Caveat',              family: cursiveVar('caveat') },
      { key: 'architects', label: 'Architects Daughter', family: cursiveVar('architects-daughter') },
      { key: 'patrick',    label: 'Patrick Hand',        family: cursiveVar('patrick-hand') },
      { key: 'shadows',    label: 'Shadows Into Light',  family: cursiveVar('shadows-into-light') },
      { key: 'kalam',      label: 'Kalam',               family: cursiveVar('kalam') },
      { key: 'indie',      label: 'Indie Flower',        family: cursiveVar('indie-flower') },
      { key: 'reenie',     label: 'Reenie Beanie',       family: cursiveVar('reenie-beanie') },
      { key: 'gloria',     label: 'Gloria Hallelujah',   family: cursiveVar('gloria-hallelujah') },
      { key: 'justanother', label: 'Just Another Hand',  family: cursiveVar('just-another-hand') },
      { key: 'pangolin',   label: 'Pangolin',            family: cursiveVar('pangolin') },
    ],
  },
  {
    key: 'pop',
    label: 'Pop',
    hint: 'Neo-Memphis 팝',
    fonts: [
      { key: 'spacegrotesk', label: 'Space Grotesk',       family: sansVar('space-grotesk') },
      { key: 'bricolage',    label: 'Bricolage Grotesque', family: sansVar('bricolage-grotesque') },
      { key: 'bagel',        label: 'Bagel Fat One',       family: sansVar('bagel-fat-one') },
      { key: 'dmserif',      label: 'DM Serif Display',    family: serifVar('dm-serif-display') },
      { key: 'outfit',       label: 'Outfit',              family: sansVar('outfit') },
      { key: 'fredoka',      label: 'Fredoka',             family: sansVar('fredoka') },
      { key: 'lilita',       label: 'Lilita One',          family: sansVar('lilita-one') },
      { key: 'bowlby',       label: 'Bowlby One',          family: sansVar('bowlby-one') },
      { key: 'modak',        label: 'Modak',               family: sansVar('modak') },
      { key: 'boogaloo',     label: 'Boogaloo',            family: sansVar('boogaloo') },
    ],
  },
  {
    key: 'mocha',
    label: 'Mocha',
    hint: '따뜻한 카페 톤 (cream/brown/serif)',
    fonts: [
      { key: 'cormorant',  label: 'Cormorant Garamond', family: serifVar('cormorant-garamond') },
      { key: 'playfair',   label: 'Playfair Display',   family: serifVar('playfair-display') },
      { key: 'fraunces',   label: 'Fraunces',           family: serifVar('fraunces') },
      { key: 'eb',         label: 'EB Garamond',        family: serifVar('eb-garamond') },
      { key: 'cinzel',     label: 'Cinzel',             family: serifVar('cinzel') },
      { key: 'italiana',   label: 'Italiana',           family: serifVar('italiana') },
      { key: 'spectral',   label: 'Spectral',           family: serifVar('spectral') },
      { key: 'crimson',    label: 'Crimson Pro',        family: serifVar('crimson-pro') },
      { key: 'instrument', label: 'Instrument Serif',   family: serifVar('instrument-serif') },
      { key: 'dmseriftext', label: 'DM Serif Text',     family: serifVar('dm-serif-text') },
    ],
  },
  {
    key: 'synthwave',
    label: 'Synthwave',
    hint: '80s 보라/핑크 그라데이션 + 그리드',
    fonts: [
      { key: 'orbitron',   label: 'Orbitron',           family: sansVar('orbitron') },
      { key: 'audiowide',  label: 'Audiowide',          family: sansVar('audiowide') },
      { key: 'bungee',     label: 'Bungee',             family: sansVar('bungee') },
      { key: 'major',      label: 'Major Mono Display', family: monoVar('major-mono-display') },
      { key: 'wallpoet',   label: 'Wallpoet',           family: sansVar('wallpoet') },
      { key: 'press2p',    label: 'Press Start 2P',     family: monoVar('press-start-2p') },
      { key: 'vt323',      label: 'VT323',              family: monoVar('vt323') },
      { key: 'sharetech',  label: 'Share Tech Mono',    family: monoVar('share-tech-mono') },
      { key: 'monoton',    label: 'Monoton',            family: sansVar('monoton') },
      { key: 'rubik',      label: 'Rubik Mono One',     family: monoVar('rubik-mono-one') },
    ],
  },
  {
    key: 'risograph',
    label: 'Risograph',
    hint: '인쇄 텍스처 + halftone + 2색 overprint',
    fonts: [
      { key: 'special',    label: 'Special Elite',      family: monoVar('special-elite') },
      { key: 'antic',      label: 'Antic Didone',       family: serifVar('antic-didone') },
      { key: 'fjalla',     label: 'Fjalla One',         family: sansVar('fjalla-one') },
      { key: 'anton',      label: 'Anton',              family: sansVar('anton') },
      { key: 'bigshoulders', label: 'Big Shoulders',    family: sansVar('big-shoulders-display') },
      { key: 'cabinsketch', label: 'Cabin Sketch',      family: cursiveVar('cabin-sketch') },
      { key: 'codystar',   label: 'Codystar',           family: sansVar('codystar') },
      { key: 'amaticsc',   label: 'Amatic SC',          family: cursiveVar('amatic-sc') },
      { key: 'unifrak',    label: 'UnifrakturCook',     family: cursiveVar('unifrakturcook') },
      { key: 'workbench',  label: 'Workbench',          family: sansVar('workbench') },
    ],
  },
  {
    key: 'blueprint',
    label: 'Blueprint',
    hint: '기술 도면: navy + 흰 grid line + mono',
    fonts: [
      { key: 'ibmplex',    label: 'IBM Plex Mono',      family: monoVar('ibm-plex-mono') },
      { key: 'robotomono', label: 'Roboto Mono',        family: monoVar('roboto-mono') },
      { key: 'sourcecode', label: 'Source Code Pro',    family: monoVar('source-code-pro') },
      { key: 'major',      label: 'Major Mono Display', family: monoVar('major-mono-display') },
      { key: 'cutive',     label: 'Cutive Mono',        family: monoVar('cutive-mono') },
      { key: 'anonymous',  label: 'Anonymous Pro',      family: monoVar('anonymous-pro') },
      { key: 'inconsolata', label: 'Inconsolata',       family: monoVar('inconsolata') },
      { key: 'firacode',   label: 'Fira Code',          family: monoVar('fira-code') },
      { key: 'sharetech',  label: 'Share Tech Mono',    family: monoVar('share-tech-mono') },
      { key: 'jetbrains',  label: 'JetBrains Mono',     family: monoVar('jetbrains-mono') },
    ],
  },
  {
    key: 'pastel',
    label: 'Pastel',
    hint: '소프트 핑크/라벤더/민트 kawaii',
    fonts: [
      { key: 'quicksand',  label: 'Quicksand',          family: sansVar('quicksand') },
      { key: 'nunito',     label: 'Nunito',             family: sansVar('nunito') },
      { key: 'comfortaa',  label: 'Comfortaa',          family: sansVar('comfortaa') },
      { key: 'varela',     label: 'Varela Round',       family: sansVar('varela-round') },
      { key: 'mplusround', label: 'M PLUS Rounded',     family: sansVar('m-plus-rounded-1c') },
      { key: 'fredoka',    label: 'Fredoka',            family: sansVar('fredoka') },
      { key: 'pangolin',   label: 'Pangolin',           family: cursiveVar('pangolin') },
      { key: 'karla',      label: 'Karla',              family: sansVar('karla') },
      { key: 'outfit',     label: 'Outfit',             family: sansVar('outfit') },
      { key: 'baloo',      label: 'Baloo 2',            family: sansVar('baloo-2') },
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
   Widget layout — 10 variant.
   ──────────────────────────────────────────────────────────────────── */

export type WidgetLayout =
  | 'classic'
  | 'banner-top'
  | 'banner-bottom'
  | 'sidebar'
  | 'sticker'
  | 'hero'
  | 'tabs'
  | 'floating-pills'
  | 'diagonal'
  | 'reverse-sidebar';

export const WIDGET_LAYOUTS: { key: WidgetLayout; label: string; hint: string }[] = [
  { key: 'classic',         label: 'Classic',  hint: '상단 헤더 + 본문 (현재)' },
  { key: 'banner-top',      label: 'Banner',   hint: '큰 컬러 hero 헤더' },
  { key: 'banner-bottom',   label: 'Polaroid', hint: '하단 caption (사진처럼)' },
  { key: 'sidebar',         label: 'Sidebar',  hint: '좌측 세로 strip + 본문' },
  { key: 'sticker',         label: 'Sticker',  hint: '떠 있는 라벨 + 기울기' },
  { key: 'hero',            label: 'Hero',     hint: '상단 60% 색 hero + 본문 40%' },
  { key: 'tabs',            label: 'Tabs',     hint: '헤더 = 탭 네비 (overview/data/history)' },
  { key: 'floating-pills',  label: 'Pills',    hint: '메타가 본문 위 떠 있는 칩' },
  { key: 'diagonal',        label: 'Diagonal', hint: '헤더 사선 컷 (45°)' },
  { key: 'reverse-sidebar', label: 'Reverse',  hint: '우측 strip + 좌측 본문 (mirror)' },
];

const LAYOUT_KEYS = new Set<string>(WIDGET_LAYOUTS.map((l) => l.key));

export function asWidgetLayout(input: unknown): WidgetLayout {
  if (typeof input === 'string' && LAYOUT_KEYS.has(input)) return input as WidgetLayout;
  return 'classic';
}

/* ────────────────────────────────────────────────────────────────────
   Widget panel — 10 variant.
   ──────────────────────────────────────────────────────────────────── */

export type WidgetPanel =
  | 'plain'
  | 'framed'
  | 'strip-footer'
  | 'cta-footer'
  | 'receipt'
  | 'tab-footer'
  | 'progress'
  | 'multi-action'
  | 'watermark'
  | 'notification';

export const WIDGET_PANELS: { key: WidgetPanel; label: string; hint: string }[] = [
  { key: 'plain',        label: 'Plain',    hint: '본문만' },
  { key: 'framed',       label: 'Framed',   hint: '본문 inner frame + inset shadow' },
  { key: 'strip-footer', label: 'Strip',    hint: '하단 컬러 strip footer' },
  { key: 'cta-footer',   label: 'CTA',      hint: '하단 큰 액션 버튼 footer' },
  { key: 'receipt',      label: 'Receipt',  hint: '본문 아래 영수증 라인' },
  { key: 'tab-footer',   label: 'Tabs',     hint: '하단 탭 네비 (settings/history/help)' },
  { key: 'progress',     label: 'Progress', hint: '본문 위 얇은 progress bar' },
  { key: 'multi-action', label: 'Actions',  hint: '하단 3 작은 액션 버튼' },
  { key: 'watermark',    label: 'Mark',     hint: '본문 뒤 큰 watermark 텍스트' },
  { key: 'notification', label: 'Notice',   hint: '하단 컬러 notification banner' },
];

const PANEL_KEYS = new Set<string>(WIDGET_PANELS.map((p) => p.key));

export function asWidgetPanel(input: unknown): WidgetPanel {
  if (typeof input === 'string' && PANEL_KEYS.has(input)) return input as WidgetPanel;
  return 'plain';
}

/* ────────────────────────────────────────────────────────────────────
   Widget interior — 10 variant.
   ──────────────────────────────────────────────────────────────────── */

export type WidgetInterior =
  | 'default'
  | 'bold'
  | 'outlined'
  | 'pill'
  | 'paper'
  | 'glass-comp'
  | 'soft3d'
  | 'sketch-comp'
  | 'brutalist'
  | 'material';

export const WIDGET_INTERIORS: { key: WidgetInterior; label: string; hint: string }[] = [
  { key: 'default',     label: 'Default',  hint: '글로벌 primitive' },
  { key: 'bold',        label: 'Bold',     hint: 'Memphis 검은 border + offset shadow' },
  { key: 'outlined',    label: 'Outlined', hint: 'outline-only, hover 시 fill' },
  { key: 'pill',        label: 'Pill',     hint: 'rounded-full + 부드러운 hover' },
  { key: 'paper',       label: 'Paper',    hint: 'text link + underline 입력' },
  { key: 'glass-comp',  label: 'Glass',    hint: 'frosted blur button/input' },
  { key: 'soft3d',      label: '3D Soft',  hint: 'Neumorphism 부드러운 3D' },
  { key: 'sketch-comp', label: 'Sketch',   hint: '손그림 dashed border' },
  { key: 'brutalist',   label: 'Brutal',   hint: '0 radius 극단 contrast' },
  { key: 'material',    label: 'Material', hint: 'drop shadow + 색 + ripple' },
];

const INTERIOR_KEYS = new Set<string>(WIDGET_INTERIORS.map((i) => i.key));

export function asWidgetInterior(input: unknown): WidgetInterior {
  if (typeof input === 'string' && INTERIOR_KEYS.has(input)) return input as WidgetInterior;
  return 'default';
}

/* ────────────────────────────────────────────────────────────────────
   Widget typography — 10 variant.
   ──────────────────────────────────────────────────────────────────── */

export type WidgetTypography =
  | 'default'
  | 'display'
  | 'compact'
  | 'mono'
  | 'editorial'
  | 'caps'
  | 'hand'
  | 'magazine'
  | 'code'
  | 'poster';

export const WIDGET_TYPOGRAPHIES: { key: WidgetTypography; label: string; hint: string }[] = [
  { key: 'default',   label: 'Default',   hint: '글로벌 Pretendard' },
  { key: 'display',   label: 'Display',   hint: '큰 헤딩 + 굵게 + tight' },
  { key: 'compact',   label: 'Compact',   hint: '작게 + dense line' },
  { key: 'mono',      label: 'Mono',      hint: '본문 전체 monospace' },
  { key: 'editorial', label: 'Editorial', hint: '헤딩 serif + 본문 sans' },
  { key: 'caps',      label: 'Caps',      hint: '모두 UPPERCASE + wide tracking' },
  { key: 'hand',      label: 'Hand',      hint: '본문 손글씨 (Caveat)' },
  { key: 'magazine',  label: 'Magazine',  hint: '큰 drop cap + serif 본문' },
  { key: 'code',      label: 'Code',      hint: '몽크/code-block 톤' },
  { key: 'poster',    label: 'Poster',    hint: '극단 display weight (Bagel/Bricolage)' },
];

const TYPOGRAPHY_KEYS = new Set<string>(WIDGET_TYPOGRAPHIES.map((t) => t.key));

export function asWidgetTypography(input: unknown): WidgetTypography {
  if (typeof input === 'string' && TYPOGRAPHY_KEYS.has(input)) return input as WidgetTypography;
  return 'default';
}
