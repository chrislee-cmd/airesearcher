/* ────────────────────────────────────────────────────────────────────
   Canvas theme SSOT — /canvas 페이지 한정 시각 variant.

   globals.css 의 `[data-canvas-theme="<key>"]` 스코프 안에서 CSS variable
   override. canvas-board / WidgetShell / Edges / Toolbar / Minimap 이
   모두 `--canvas-*` variable 을 사용 → data-attribute 한 줄 바꾸면 전부
   리스킨.

   적용 범위: /canvas 의 board container 안에만. 다른 라우트 / 글로벌
   토큰 영향 X.
   ──────────────────────────────────────────────────────────────────── */

export type CanvasTheme = 'default' | 'cyber' | 'glass' | 'swiss' | 'sketch' | 'pop';

export const CANVAS_THEMES: { key: CanvasTheme; label: string; hint: string }[] = [
  { key: 'default', label: 'Notion',   hint: '클린 베이스 (현재)' },
  { key: 'cyber',   label: 'Cyber',    hint: '다크 터미널 + cyan' },
  { key: 'glass',   label: 'Glass',    hint: 'Vision Pro frosted' },
  { key: 'swiss',   label: 'Swiss',    hint: '흑백 brutalist' },
  { key: 'sketch',  label: 'Sketch',   hint: '손그림 노트' },
  { key: 'pop',     label: 'Pop',      hint: 'Neo-Memphis 팝' },
];

const VALID = new Set<string>(CANVAS_THEMES.map((t) => t.key));

export function asCanvasTheme(input: unknown): CanvasTheme {
  if (typeof input === 'string' && VALID.has(input)) return input as CanvasTheme;
  return 'default';
}
