// SlideGen IR — SPEC.md §4 (consolidated v0.2).
//
// Pipeline: report text → buildDeckSpec → DeckSpec → registry[layoutType]
// .toElements(payload) → Element[] (1280×720 canvas) → ReadOnlyCanvas (PR1)
// / Editor (PR2) / PptxGenJS exporter (PR3).
//
// All coordinates and dimensions are in canvas px on a 1280×720 (16:9 @
// 96 DPI) coordinate space. The canvas component scales those numbers to
// fit the preview viewport.

export type LayoutType =
  | 'two_by_two'
  | 'process_flow'
  | 'pyramid'
  | 'bullet_body';

export type BulletBodyPayload = {
  bullets: string[];
  body: string | null;
};

// Diagram payloads beyond bullet_body land with the per-diagram PRs
// (`feat/slidegen-two-by-two` etc.). They are listed here for the union
// shape so SlideSpec.payload stays exhaustively typed once they arrive.
export type TwoByTwoPayload = {
  xAxis: { low: string; high: string };
  yAxis: { low: string; high: string };
  quadrants: {
    position: 'TL' | 'TR' | 'BL' | 'BR';
    label: string;
    items: string[];
  }[];
};

export type ProcessFlowPayload = {
  steps: { order: number; title: string; desc: string }[];
};

export type PyramidPayload = {
  levels: { tier: number; label: string; desc: string }[];
};

export type SlidePayload =
  | { layoutType: 'bullet_body'; payload: BulletBodyPayload }
  | { layoutType: 'two_by_two'; payload: TwoByTwoPayload }
  | { layoutType: 'process_flow'; payload: ProcessFlowPayload }
  | { layoutType: 'pyramid'; payload: PyramidPayload };

export type SlideSpec = {
  id: string;
  actionTitle: string;
  speakerNotes: string | null;
  sourceRefs: number[];
} & SlidePayload;

export type DeckMeta = {
  title: string;
  client: string | null;
  author: string | null;
  theme: 'primary_source';
  createdAt: string;
};

export type DeckSpec = {
  meta: DeckMeta;
  slides: SlideSpec[];
};

// Element model — absolute-positioned primitive shapes the canvas and the
// PptxGenJS exporter both consume. Hex literals (not Tailwind tokens)
// because these end up in the .pptx as well.

type ElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TextElement = ElementBase & {
  type: 'text';
  content: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
};

export type RectElement = ElementBase & {
  type: 'rect';
  fill?: string;
  border?: string;
  borderLeft?: { width: number; color: string };
  borderRadius?: number;
};

export type SlideElement = TextElement | RectElement;

export type DiagramTemplate<P = unknown> = {
  type: LayoutType;
  label: string;
  selectionHint: string;
  validate: (payload: unknown) => payload is P;
  toElements: (payload: P) => SlideElement[];
};

// Canvas constants — kept here so the canvas, the per-diagram templates,
// and the export step share one source of truth.
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
export const THEME = {
  ink: '#15191F',
  accent: '#2D4CDB',
  hairline: '#E4E7EC',
  muted: '#727A86',
  paper: '#FFFFFF',
} as const;
