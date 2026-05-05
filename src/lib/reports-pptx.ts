// Build a PPTX from the canonical report Markdown produced by
// /api/reports/normalize. We don't try to faithfully reproduce the HTML
// design — slides have a different rhythm — but we keep the same single
// accent (#1F5795) and the same UPPERCASE eyebrow / 4px-radius vocabulary
// the rest of the system uses.

type Slide = {
  eyebrow: string;
  title: string;
  body: { kind: 'bullet'; text: string }[] | { kind: 'text'; text: string }[];
  quotes?: { text: string; cite: string }[];
};

type ParsedSection = {
  level: 1 | 2 | 3;
  title: string;
  body: string[];
  quotes: { text: string; cite: string }[];
};

const ACCENT = '1F5795';
const INK = '1A1A1A';
const MUTE = '5A5A5A';
const MUTE_SOFT = '9B9B9B';
const LINE = 'E1E3E8';

function parseFrontmatter(md: string): { meta: Record<string, string>; rest: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, rest: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) meta[key] = val;
    }
  }
  return { meta, rest: m[2] };
}

function parseSections(md: string): ParsedSection[] {
  const lines = md.split('\n');
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let inBlockquote = false;
  let bqBuf: string[] = [];

  function flushQuote() {
    if (bqBuf.length === 0 || !current) {
      bqBuf = [];
      inBlockquote = false;
      return;
    }
    // First line is the quote, the next "— …" line is the cite.
    let quote = bqBuf[0]?.replace(/^["“”]|["“”]$/g, '').trim() ?? '';
    let cite = '';
    for (const l of bqBuf.slice(1)) {
      if (/^[—–-]/.test(l.trim())) cite = l.trim().replace(/^[—–-]\s*/, '');
      else if (l.trim()) quote += ' ' + l.trim();
    }
    if (quote) current.quotes.push({ text: quote, cite });
    bqBuf = [];
    inBlockquote = false;
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushQuote();
      const level = h[1].length as 1 | 2 | 3;
      current = { level, title: h[2].trim(), body: [], quotes: [] };
      sections.push(current);
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq && current) {
      inBlockquote = true;
      bqBuf.push(bq[1] ?? '');
      continue;
    }
    if (inBlockquote) flushQuote();
    if (current && line.trim()) {
      current.body.push(line);
    }
  }
  flushQuote();
  return sections;
}

function buildSlideOutline(md: string): { cover: { title: string; subtitle: string; meta: Record<string, string> }; slides: Slide[] } {
  const { meta, rest } = parseFrontmatter(md);
  const sections = parseSections(rest);

  const coverTitle = meta.title || sections.find((s) => s.level === 1)?.title || '리포트';
  const coverSubtitle = meta.subtitle || '';

  // Group h2 sections; h3 children become sub-bullets.
  const slides: Slide[] = [];
  let i = 0;
  while (i < sections.length) {
    const s = sections[i];
    if (s.level === 1) {
      i += 1;
      continue;
    }
    if (s.level === 2) {
      const eyebrow = s.title.match(/^Chapter\s/i) ? 'CHAPTER' : 'SECTION';
      const bullets: string[] = [];
      const quotes = [...s.quotes];
      for (const para of s.body) {
        const b = para.match(/^[-*]\s+(.+)$/);
        if (b) bullets.push(b[1]);
        else if (para.trim()) bullets.push(para.trim());
      }
      i += 1;
      while (i < sections.length && sections[i].level === 3) {
        const sub = sections[i];
        bullets.push(`【${sub.title}】`);
        for (const para of sub.body) {
          const b = para.match(/^[-*]\s+(.+)$/);
          if (b) bullets.push(`  · ${b[1]}`);
          else if (para.trim()) bullets.push(`  ${para.trim()}`);
        }
        for (const q of sub.quotes) quotes.push(q);
        i += 1;
      }
      slides.push({
        eyebrow,
        title: s.title,
        body: bullets.map((t) => ({ kind: 'bullet' as const, text: t })),
        quotes,
      });
      continue;
    }
    i += 1;
  }

  return {
    cover: { title: coverTitle, subtitle: coverSubtitle, meta },
    slides,
  };
}

export async function buildReportPptxBlob(markdown: string): Promise<Blob> {
  // Dynamic import — pptxgenjs is heavy and only needed on click.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = 'Research Report';

  const outline = buildSlideOutline(markdown);

  // Cover slide.
  const cover = pptx.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape('line', {
    x: 0.6,
    y: 1.0,
    w: 0.4,
    h: 0,
    line: { color: ACCENT, width: 1 },
  });
  cover.addText('RESEARCH REPORT', {
    x: 0.6,
    y: 1.05,
    w: 8,
    h: 0.3,
    fontFace: 'Pretendard',
    fontSize: 10,
    color: ACCENT,
    bold: true,
    charSpacing: 22,
  });
  cover.addText(outline.cover.title, {
    x: 0.6,
    y: 1.6,
    w: 12,
    h: 1.6,
    fontFace: 'Pretendard',
    fontSize: 36,
    bold: true,
    color: INK,
  });
  if (outline.cover.subtitle) {
    cover.addText(outline.cover.subtitle, {
      x: 0.6,
      y: 3.1,
      w: 12,
      h: 0.5,
      fontFace: 'Pretendard',
      fontSize: 16,
      color: MUTE,
    });
  }
  const metaRows = [
    ['METHOD', outline.cover.meta.method ?? '—'],
    ['SAMPLE', outline.cover.meta.sample ?? '—'],
    ['PERIOD', outline.cover.meta.period ?? '—'],
    ['CHAPTERS', String(outline.slides.filter((s) => s.eyebrow === 'CHAPTER').length || outline.slides.length)],
  ];
  metaRows.forEach(([label, value], idx) => {
    const x = 0.6 + idx * 3.05;
    cover.addText(label, {
      x,
      y: 5.2,
      w: 2.8,
      h: 0.3,
      fontFace: 'Pretendard',
      fontSize: 9,
      color: MUTE_SOFT,
      bold: true,
      charSpacing: 22,
    });
    cover.addText(value, {
      x,
      y: 5.55,
      w: 2.8,
      h: 0.5,
      fontFace: 'Pretendard',
      fontSize: 17,
      bold: true,
      color: INK,
    });
  });
  cover.addShape('rect', {
    x: 0.6,
    y: 6.6,
    w: 12.1,
    h: 0,
    line: { color: LINE, width: 1 },
  });

  // Content slides.
  for (const s of outline.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape('line', {
      x: 0.6,
      y: 0.7,
      w: 0.3,
      h: 0,
      line: { color: ACCENT, width: 1 },
    });
    slide.addText(s.eyebrow, {
      x: 0.95,
      y: 0.55,
      w: 6,
      h: 0.3,
      fontFace: 'Pretendard',
      fontSize: 9,
      color: ACCENT,
      bold: true,
      charSpacing: 22,
    });
    slide.addText(s.title, {
      x: 0.6,
      y: 0.95,
      w: 12.1,
      h: 0.7,
      fontFace: 'Pretendard',
      fontSize: 22,
      bold: true,
      color: INK,
    });
    slide.addShape('line', {
      x: 0.6,
      y: 1.7,
      w: 12.1,
      h: 0,
      line: { color: LINE, width: 1 },
    });

    const bulletItems = s.body
      .filter((b) => b.text.trim())
      .map((b) => ({
        text: b.text,
        options: {
          fontFace: 'Pretendard',
          fontSize: 12,
          color: INK,
          bullet: { type: 'bullet' as const },
          paraSpaceAfter: 6,
        },
      }));
    if (bulletItems.length > 0) {
      slide.addText(bulletItems, {
        x: 0.6,
        y: 1.95,
        w: s.quotes && s.quotes.length > 0 ? 7.6 : 12.1,
        h: 5.0,
        valign: 'top',
      });
    }

    if (s.quotes && s.quotes.length > 0) {
      const quoteText: { text: string; options?: object }[] = [];
      for (const q of s.quotes.slice(0, 3)) {
        quoteText.push({
          text: `"${q.text}"`,
          options: {
            fontFace: 'Pretendard',
            fontSize: 12,
            italic: true,
            color: MUTE,
            paraSpaceAfter: 4,
          },
        });
        if (q.cite) {
          quoteText.push({
            text: `— ${q.cite}\n`,
            options: {
              fontFace: 'Pretendard',
              fontSize: 10,
              color: MUTE_SOFT,
              paraSpaceAfter: 14,
            },
          });
        }
      }
      slide.addShape('rect', {
        x: 8.4,
        y: 1.95,
        w: 0.02,
        h: 4.8,
        fill: { color: ACCENT },
        line: { color: ACCENT, width: 0 },
      });
      slide.addText(quoteText, {
        x: 8.55,
        y: 1.95,
        w: 4.1,
        h: 5.0,
        valign: 'top',
      });
    }
  }

  // pptxgenjs in browser returns a Blob via outputType 'blob'.
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  return blob;
}
