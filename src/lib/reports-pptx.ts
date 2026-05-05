import type { SlideOutline, Slide } from '@/lib/reports-slides-schema';

// PPTX renderer driven by the typed slide outline produced by
// /api/reports/slides. Each slide kind has a dedicated layout — we don't
// dump bullets onto a generic template. All slides keep the same single
// amore accent (#1F5795), Pretendard, 4px radius, no shadow vocabulary
// the rest of the system uses.

const ACCENT = '1F5795';
const ACCENT_SOFT = '3D72AD';
const ACCENT_BG = 'EAF0F8';
const INK = '1A1A1A';
const MUTE = '5A5A5A';
const MUTE_SOFT = '9B9B9B';
const LINE = 'E1E3E8';
const LINE_SOFT = 'F1F3F6';
const FONT = 'Pretendard';

// LAYOUT_WIDE = 13.33 x 7.5 in
const W = 13.33;
const H = 7.5;
const MARGIN_X = 0.7;
const MARGIN_Y_TOP = 0.55;
const HEADER_BOTTOM = 1.7;

type AnyPptxSlide = ReturnType<ReturnType<typeof createPptx>['pptx']['addSlide']>;

function createPptx(PptxGenJS: new () => unknown) {
  // We don't have type defs for the constructor here — pptxgenjs's d.ts
  // exports a namespace + default. We just trust the runtime shape.
  const pptx = new PptxGenJS() as unknown as {
    layout: string;
    title: string;
    addSlide: () => unknown;
    write: (opts: { outputType: string }) => Promise<unknown>;
  };
  return { pptx };
}

function addEyebrow(slide: AnyPptxSlide, text: string) {
  // Short accent line + UPPERCASE label, anchored top-left.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = slide as any;
  s.addShape('line', {
    x: MARGIN_X,
    y: MARGIN_Y_TOP + 0.16,
    w: 0.3,
    h: 0,
    line: { color: ACCENT, width: 1 },
  });
  s.addText(text, {
    x: MARGIN_X + 0.36,
    y: MARGIN_Y_TOP,
    w: 8,
    h: 0.32,
    fontFace: FONT,
    fontSize: 9,
    color: ACCENT,
    bold: true,
    charSpacing: 22,
  });
}

function addTitle(slide: AnyPptxSlide, title: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = slide as any;
  s.addText(title, {
    x: MARGIN_X,
    y: MARGIN_Y_TOP + 0.42,
    w: W - MARGIN_X * 2,
    h: 0.85,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: INK,
  });
  s.addShape('line', {
    x: MARGIN_X,
    y: HEADER_BOTTOM,
    w: W - MARGIN_X * 2,
    h: 0,
    line: { color: LINE, width: 1 },
  });
}

function blank(pptx: ReturnType<typeof createPptx>['pptx']) {
  const slide = pptx.addSlide() as AnyPptxSlide;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (slide as any).background = { color: 'FFFFFF' };
  return slide;
}

function renderCover(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'cover' }>) {
  const slide = blank(pptx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  sl.addShape('line', {
    x: MARGIN_X,
    y: 1.1,
    w: 0.45,
    h: 0,
    line: { color: ACCENT, width: 1 },
  });
  sl.addText('RESEARCH REPORT', {
    x: MARGIN_X,
    y: 1.2,
    w: 8,
    h: 0.3,
    fontFace: FONT,
    fontSize: 10,
    color: ACCENT,
    bold: true,
    charSpacing: 22,
  });
  sl.addText(s.title, {
    x: MARGIN_X,
    y: 1.8,
    w: W - MARGIN_X * 2,
    h: 1.6,
    fontFace: FONT,
    fontSize: 36,
    bold: true,
    color: INK,
  });
  if (s.subtitle) {
    sl.addText(s.subtitle, {
      x: MARGIN_X,
      y: 3.4,
      w: W - MARGIN_X * 2,
      h: 0.6,
      fontFace: FONT,
      fontSize: 16,
      color: MUTE,
    });
  }
  const meta = s.meta;
  const rows: [string, string][] = [
    ['METHOD', meta.method ?? '—'],
    ['SAMPLE', meta.sample ?? '—'],
    ['PERIOD', meta.period ?? '—'],
    ['CHAPTERS', meta.chapters ?? '—'],
  ];
  rows.forEach(([label, value], i) => {
    const colW = (W - MARGIN_X * 2) / 4;
    const x = MARGIN_X + i * colW;
    sl.addText(label, {
      x,
      y: 5.4,
      w: colW - 0.2,
      h: 0.3,
      fontFace: FONT,
      fontSize: 9,
      color: MUTE_SOFT,
      bold: true,
      charSpacing: 22,
    });
    sl.addText(value, {
      x,
      y: 5.75,
      w: colW - 0.2,
      h: 0.6,
      fontFace: FONT,
      fontSize: 17,
      bold: true,
      color: INK,
    });
  });
  sl.addShape('line', {
    x: MARGIN_X,
    y: 6.7,
    w: W - MARGIN_X * 2,
    h: 0,
    line: { color: LINE, width: 1 },
  });
}

function renderSectionDivider(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'section_divider' }>) {
  const slide = blank(pptx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  sl.addShape('rect', {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: ACCENT_BG },
    line: { color: ACCENT_BG, width: 0 },
  });
  sl.addShape('line', {
    x: MARGIN_X,
    y: 3.0,
    w: 0.5,
    h: 0,
    line: { color: ACCENT, width: 1.5 },
  });
  sl.addText(s.eyebrow, {
    x: MARGIN_X,
    y: 3.1,
    w: 8,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    color: ACCENT,
    bold: true,
    charSpacing: 24,
  });
  sl.addText(s.title, {
    x: MARGIN_X,
    y: 3.7,
    w: W - MARGIN_X * 2,
    h: 1.4,
    fontFace: FONT,
    fontSize: 32,
    bold: true,
    color: INK,
  });
  if (s.subtitle) {
    sl.addText(s.subtitle, {
      x: MARGIN_X,
      y: 5.0,
      w: W - MARGIN_X * 2,
      h: 0.5,
      fontFace: FONT,
      fontSize: 15,
      color: MUTE,
    });
  }
}

function renderKpiGrid(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'kpi_grid' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  const n = s.items.length;
  const gap = 0.3;
  const totalW = W - MARGIN_X * 2;
  const cardW = (totalW - gap * (n - 1)) / n;
  const cardH = 4.6;
  s.items.forEach((item, i) => {
    const x = MARGIN_X + i * (cardW + gap);
    const y = 2.0;
    sl.addShape('rect', {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: 'FFFFFF' },
      line: { color: LINE, width: 1 },
    });
    sl.addShape('line', {
      x,
      y,
      w: cardW,
      h: 0,
      line: { color: ACCENT, width: 2 },
    });
    sl.addText(item.label, {
      x: x + 0.25,
      y: y + 0.3,
      w: cardW - 0.5,
      h: 0.35,
      fontFace: FONT,
      fontSize: 10,
      color: MUTE_SOFT,
      bold: true,
      charSpacing: 22,
    });
    sl.addText(item.value, {
      x: x + 0.25,
      y: y + 0.85,
      w: cardW - 0.5,
      h: 1.4,
      fontFace: FONT,
      fontSize: 30,
      bold: true,
      color: INK,
    });
    if (item.note) {
      sl.addText(item.note, {
        x: x + 0.25,
        y: y + 2.4,
        w: cardW - 0.5,
        h: 1.8,
        fontFace: FONT,
        fontSize: 12,
        color: MUTE,
        valign: 'top',
      });
    }
  });
}

function renderInsightCards(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'insight_cards' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  const n = s.cards.length;
  const cols = n <= 2 ? n : Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const totalW = W - MARGIN_X * 2;
  const cardW = (totalW - gap * (cols - 1)) / cols;
  const totalH = H - 2.0 - 0.5;
  const cardH = (totalH - gap * (rows - 1)) / rows;
  s.cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN_X + col * (cardW + gap);
    const y = 2.0 + row * (cardH + gap);
    sl.addShape('rect', {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: 'FFFFFF' },
      line: { color: LINE, width: 1 },
    });
    sl.addShape('line', {
      x,
      y,
      w: 0.4,
      h: 0,
      line: { color: ACCENT, width: 2 },
    });
    sl.addText(`0${i + 1}`.slice(-2), {
      x: x + 0.3,
      y: y + 0.25,
      w: 1,
      h: 0.3,
      fontFace: FONT,
      fontSize: 10,
      color: ACCENT,
      bold: true,
      charSpacing: 22,
    });
    sl.addText(card.heading, {
      x: x + 0.3,
      y: y + 0.65,
      w: cardW - 0.6,
      h: 0.9,
      fontFace: FONT,
      fontSize: 16,
      bold: true,
      color: INK,
    });
    sl.addText(card.body, {
      x: x + 0.3,
      y: y + 1.65,
      w: cardW - 0.6,
      h: cardH - 1.85,
      fontFace: FONT,
      fontSize: 12,
      color: MUTE,
      valign: 'top',
    });
  });
}

function renderThemeSplit(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'theme_split' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;

  const hasQuote = !!s.verbatim;
  const leftW = hasQuote ? 7.6 : W - MARGIN_X * 2;

  const bullets = s.findings.map((b, i) => ({
    text: b,
    options: {
      fontFace: FONT,
      fontSize: 14,
      color: INK,
      bullet: { type: 'bullet' as const },
      paraSpaceAfter: 8,
      paraSpaceBefore: i === 0 ? 0 : 4,
    },
  }));
  sl.addText(bullets, {
    x: MARGIN_X,
    y: 2.0,
    w: leftW,
    h: s.implication ? 4.3 : 4.9,
    valign: 'top',
  });

  if (s.implication) {
    sl.addShape('rect', {
      x: MARGIN_X,
      y: 6.4,
      w: leftW,
      h: 0.6,
      fill: { color: ACCENT_BG },
      line: { color: ACCENT_BG, width: 0 },
    });
    sl.addText(`→ ${s.implication}`, {
      x: MARGIN_X + 0.2,
      y: 6.4,
      w: leftW - 0.4,
      h: 0.6,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: ACCENT,
      valign: 'middle',
    });
  }

  if (hasQuote && s.verbatim) {
    const qx = MARGIN_X + leftW + 0.4;
    const qw = W - MARGIN_X - qx;
    sl.addShape('rect', {
      x: qx,
      y: 2.0,
      w: 0.04,
      h: 4.8,
      fill: { color: ACCENT },
      line: { color: ACCENT, width: 0 },
    });
    sl.addText(`"${s.verbatim.text}"`, {
      x: qx + 0.2,
      y: 2.0,
      w: qw - 0.2,
      h: 4.0,
      fontFace: FONT,
      fontSize: 13,
      italic: true,
      color: MUTE,
      valign: 'top',
    });
    if (s.verbatim.cite) {
      sl.addText(`— ${s.verbatim.cite}`, {
        x: qx + 0.2,
        y: 6.1,
        w: qw - 0.2,
        h: 0.6,
        fontFace: FONT,
        fontSize: 11,
        color: MUTE_SOFT,
      });
    }
  }
}

function renderQuoteCard(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'quote_card' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  // Big mark
  sl.addText('"', {
    x: MARGIN_X,
    y: 2.0,
    w: 1,
    h: 1.5,
    fontFace: FONT,
    fontSize: 80,
    bold: true,
    color: ACCENT,
    valign: 'top',
  });
  sl.addText(s.quote, {
    x: MARGIN_X + 1.0,
    y: 2.3,
    w: W - MARGIN_X * 2 - 1.0,
    h: 3.6,
    fontFace: FONT,
    fontSize: 22,
    italic: true,
    color: INK,
    valign: 'top',
  });
  if (s.cite) {
    sl.addText(`— ${s.cite}`, {
      x: MARGIN_X + 1.0,
      y: 6.0,
      w: W - MARGIN_X * 2 - 1.0,
      h: 0.5,
      fontFace: FONT,
      fontSize: 14,
      color: MUTE_SOFT,
    });
  }
  if (s.context) {
    sl.addText(s.context, {
      x: MARGIN_X + 1.0,
      y: 6.5,
      w: W - MARGIN_X * 2 - 1.0,
      h: 0.5,
      fontFace: FONT,
      fontSize: 12,
      color: MUTE,
    });
  }
}

function renderBarChart(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'bar_chart' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;

  // Native pptx bar chart, sorted by value desc.
  const sorted = [...s.series].sort((a, b) => b.value - a.value);
  const chartData = [
    {
      name: 'value',
      labels: sorted.map((d) => d.label),
      values: sorted.map((d) => d.value),
    },
  ];
  // pptxgenjs expects ChartType enum but accepts string in practice.
  sl.addChart('bar', chartData, {
    x: MARGIN_X,
    y: 2.0,
    w: W - MARGIN_X * 2,
    h: s.note ? 4.3 : 4.9,
    barDir: 'bar',
    barGrouping: 'standard',
    chartColors: [ACCENT],
    catAxisLabelFontFace: FONT,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: INK,
    valAxisLabelFontFace: FONT,
    valAxisLabelFontSize: 10,
    valAxisLabelColor: MUTE,
    showValue: true,
    dataLabelFontFace: FONT,
    dataLabelFontSize: 10,
    dataLabelColor: ACCENT,
    dataLabelFormatCode: s.valueSuffix === '%' ? '0"%"' : 'General',
    showLegend: false,
    showTitle: false,
  });
  if (s.note) {
    sl.addText(s.note, {
      x: MARGIN_X,
      y: 6.4,
      w: W - MARGIN_X * 2,
      h: 0.6,
      fontFace: FONT,
      fontSize: 11,
      color: MUTE_SOFT,
      italic: true,
    });
  }
}

function renderTable(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'table' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;

  const headerRow = s.columns.map((c) => ({
    text: c,
    options: {
      bold: true,
      color: ACCENT,
      fill: { color: LINE_SOFT },
      fontFace: FONT,
      fontSize: 11,
      charSpacing: 22,
    },
  }));
  const dataRows = s.rows.map((r) =>
    r.map((cell) => ({
      text: cell,
      options: {
        color: INK,
        fontFace: FONT,
        fontSize: 12,
      },
    })),
  );
  // Pad rows to column count.
  for (const r of dataRows) {
    while (r.length < s.columns.length)
      r.push({ text: '', options: { color: INK, fontFace: FONT, fontSize: 12 } });
  }
  sl.addTable([headerRow, ...dataRows], {
    x: MARGIN_X,
    y: 2.0,
    w: W - MARGIN_X * 2,
    colW: Array(s.columns.length).fill((W - MARGIN_X * 2) / s.columns.length),
    border: { type: 'solid', pt: 0.5, color: LINE },
    fontFace: FONT,
  });
}

function renderRecommendations(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'recommendations' }>) {
  const slide = blank(pptx);
  addEyebrow(slide, s.eyebrow);
  addTitle(slide, s.title);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  const n = s.items.length;
  const gap = 0.18;
  const totalH = H - 2.0 - 0.5;
  const cardH = (totalH - gap * (n - 1)) / n;
  s.items.forEach((item, i) => {
    const y = 2.0 + i * (cardH + gap);
    const priorityColor =
      item.priority === 'high' ? ACCENT : item.priority === 'medium' ? ACCENT_SOFT : MUTE_SOFT;
    sl.addShape('rect', {
      x: MARGIN_X,
      y,
      w: W - MARGIN_X * 2,
      h: cardH,
      fill: { color: 'FFFFFF' },
      line: { color: LINE, width: 1 },
    });
    sl.addShape('rect', {
      x: MARGIN_X,
      y,
      w: 0.08,
      h: cardH,
      fill: { color: priorityColor },
      line: { color: priorityColor, width: 0 },
    });
    sl.addText(`0${i + 1}`.slice(-2), {
      x: MARGIN_X + 0.3,
      y: y + 0.2,
      w: 0.7,
      h: 0.4,
      fontFace: FONT,
      fontSize: 11,
      color: priorityColor,
      bold: true,
      charSpacing: 22,
    });
    sl.addText(item.headline, {
      x: MARGIN_X + 1.0,
      y: y + 0.18,
      w: W - MARGIN_X * 2 - 1.2,
      h: 0.5,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: INK,
    });
    if (item.detail) {
      sl.addText(item.detail, {
        x: MARGIN_X + 1.0,
        y: y + 0.7,
        w: W - MARGIN_X * 2 - 1.2,
        h: cardH - 0.85,
        fontFace: FONT,
        fontSize: 11.5,
        color: MUTE,
        valign: 'top',
      });
    }
  });
}

function renderClosing(pptx: ReturnType<typeof createPptx>['pptx'], s: Extract<Slide, { kind: 'closing' }>) {
  const slide = blank(pptx);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl = slide as any;
  sl.addShape('rect', {
    x: 0,
    y: 0,
    w: W,
    h: H,
    fill: { color: 'FFFFFF' },
    line: { color: 'FFFFFF', width: 0 },
  });
  sl.addShape('line', {
    x: W / 2 - 0.4,
    y: H / 2 - 0.6,
    w: 0.8,
    h: 0,
    line: { color: ACCENT, width: 1 },
  });
  sl.addText(s.title, {
    x: 0,
    y: H / 2 - 0.4,
    w: W,
    h: 1.0,
    fontFace: FONT,
    fontSize: 40,
    bold: true,
    color: INK,
    align: 'center',
  });
  if (s.subtitle) {
    sl.addText(s.subtitle, {
      x: 0,
      y: H / 2 + 0.7,
      w: W,
      h: 0.5,
      fontFace: FONT,
      fontSize: 14,
      color: MUTE,
      align: 'center',
    });
  }
}

export async function buildReportPptxBlob(outline: SlideOutline): Promise<Blob> {
  const mod = await import('pptxgenjs');
  const PptxGenJS = (mod.default ?? mod) as unknown as new () => unknown;
  const { pptx } = createPptx(PptxGenJS);
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Research Report';

  for (const slide of outline.slides) {
    switch (slide.kind) {
      case 'cover':
        renderCover(pptx, slide);
        break;
      case 'section_divider':
        renderSectionDivider(pptx, slide);
        break;
      case 'kpi_grid':
        renderKpiGrid(pptx, slide);
        break;
      case 'insight_cards':
        renderInsightCards(pptx, slide);
        break;
      case 'theme_split':
        renderThemeSplit(pptx, slide);
        break;
      case 'quote_card':
        renderQuoteCard(pptx, slide);
        break;
      case 'bar_chart':
        renderBarChart(pptx, slide);
        break;
      case 'table':
        renderTable(pptx, slide);
        break;
      case 'recommendations':
        renderRecommendations(pptx, slide);
        break;
      case 'closing':
        renderClosing(pptx, slide);
        break;
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}
