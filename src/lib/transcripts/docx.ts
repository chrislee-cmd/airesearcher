import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

// Design system tokens (mirrors design-system.md §2)
const AP = {
  amore: '1F5795',
  ink: '000000',
  ink2: '1A1A1A',
  mute: '5A5A5A',
  muteSoft: '9B9B9B',
  line: 'E1E3E8',
} as const;

// docx sizes are in half-points; line spacing is 240ths (240 = 1.0).
const SIZE = {
  h1: 72, // 36pt — Cover Title
  h2: 40, // 20pt — Chapter Title
  subtitle: 22, // 11pt
  eyebrow: 18, // 9pt UPPERCASE
  metaValue: 26, // 13pt
  body: 25, // 12.5pt
} as const;

// Speaker-turn line. Tolerates an optional `**…**` bold wrap around the
// `[hh:mm:ss] Speaker:` prefix — the English translate pipeline emits
// `**[00:00:00] Interviewee:** text` while the Korean ElevenLabs pipeline emits
// the bare `[00:00:03] Speaker 1: text`. Both must render as an eyebrow line.
const TIMESTAMP_RE = /^\*{0,2}\[(\d{2}:\d{2}:\d{2})\]\s+([^:*]+):\*{0,2}\s*(.*)$/;

// Inline `**bold**` → bold runs. Everything outside the markers renders as a
// plain run, so stray single `*` / `_` pass through untouched. Used for body
// text (which may carry emphasis) and for any non-timestamp body line.
function inlineRuns(text: string, size: number, color: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: text.slice(last, m.index), size, color }));
    }
    runs.push(new TextRun({ text: m[1], bold: true, size, color }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), size, color }));
  }
  if (runs.length === 0) runs.push(new TextRun({ text: '', size, color }));
  return runs;
}

function eyebrow(text: string, color: string = AP.amore): TextRun {
  return new TextRun({
    text: text.toUpperCase(),
    bold: true,
    size: SIZE.eyebrow,
    color,
    characterSpacing: 40, // ≈ .22em at 9pt
    font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
  });
}

function thinRule(color: string = AP.amore, after = 120): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color, space: 1 },
    },
    children: [new TextRun({ text: '' })],
  });
}

function blank(after = 120): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after },
    children: [new TextRun({ text: '' })],
  });
}

// US Letter (12240) − 1" margins both sides (2 × 1440) = 9360 twips of body width.
const PAGE_BODY_DXA = 9360;
const META_COL_DXA = Math.floor(PAGE_BODY_DXA / 4); // 2340

function metaCell(label: string, value: string): TableCell {
  return new TableCell({
    width: { size: META_COL_DXA, type: WidthType.DXA },
    margins: { top: 120, bottom: 120, left: 0, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: AP.line },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    children: [
      new Paragraph({
        spacing: { after: 60 },
        children: [eyebrow(label, AP.muteSoft)],
      }),
      new Paragraph({
        spacing: { after: 0 },
        children: [
          new TextRun({
            text: value || '—',
            bold: true,
            size: SIZE.metaValue,
            color: AP.ink2,
          }),
        ],
      }),
    ],
  });
}

function emptyMetaCell(): TableCell {
  return new TableCell({
    width: { size: META_COL_DXA, type: WidthType.DXA },
    margins: { top: 120, bottom: 120, left: 0, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: AP.line },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
  });
}

// Editorial 4-up stat grid. Front matter beyond the first four fields (the
// English translate pipeline carries date / source_target / roles / note) wraps
// into additional rows of four, padded with empty cells so the FIXED layout
// stays column-aligned.
function metaTable(entries: Array<[string, string]>): Table {
  const rows: TableRow[] = [];
  for (let i = 0; i < entries.length; i += 4) {
    const cells = entries.slice(i, i + 4).map(([k, v]) => metaCell(k, v));
    while (cells.length < 4) cells.push(emptyMetaCell());
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({
    width: { size: PAGE_BODY_DXA, type: WidthType.DXA },
    columnWidths: [META_COL_DXA, META_COL_DXA, META_COL_DXA, META_COL_DXA],
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows,
  });
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert our transcript markdown (front matter + `[hh:mm:ss] Speaker N: text`
 * lines) into an editorial docx that follows design-system.md:
 * UPPERCASE eyebrow, 1px amore accent, 4-stat meta grid, Pretendard body.
 */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const lines = markdown.split(/\r?\n/);

  // Split YAML front matter from body. The `---` fence isn't always on line 0:
  // the English translate pipeline prefixes a `# <title>` heading (a duplicate
  // of the `file:` field) and/or blank lines before the fence, which used to
  // leak the whole front matter block into the body as raw text. Scan past a
  // single leading heading + surrounding blanks to find the opening fence; if
  // none is found we keep every line (including that heading) in the body.
  const front: Record<string, string> = {};
  const body: string[] = [];

  let frontStart = -1;
  {
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i < lines.length && /^#{1,6}\s/.test(lines[i])) {
      i++;
      while (i < lines.length && !lines[i].trim()) i++;
    }
    if (i < lines.length && lines[i].trim() === '---') frontStart = i;
  }

  let bodyStart = 0;
  if (frontStart >= 0) {
    let i = frontStart + 1;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') {
        i++;
        break;
      }
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key) front[key] = val;
      }
    }
    bodyStart = i;
  }
  for (let i = bodyStart; i < lines.length; i++) body.push(lines[i]);

  const fileName = front.file ?? 'Transcript';
  const duration = front.duration ?? '—';
  // English translate jobs carry `roles:` (Interviewer / Interviewee) instead
  // of `speakers:`; fall back to it so the stat cell isn't an empty dash.
  const speakers = front.speakers ?? front.roles ?? '—';

  const children: Array<Paragraph | Table> = [];

  // ── Cover ────────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [eyebrow('Research-Canvas', AP.muteSoft)],
    }),
  );
  children.push(thinRule(AP.amore, 140));
  children.push(
    new Paragraph({
      spacing: { after: 100 },
      children: [eyebrow('Transcript · Timestamped')],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: fileName,
          bold: true,
          size: SIZE.h1,
          color: AP.ink,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 320 },
      children: [
        new TextRun({
          text: 'QUALITATIVE INTERVIEW · SPEAKER-DIARIZED',
          size: SIZE.subtitle,
          color: AP.mute,
          characterSpacing: 30,
        }),
      ],
    }),
  );

  // Base four stats, then surface any remaining front-matter fields (date,
  // source_target, note, …) so the English pipeline's metadata renders in the
  // grid instead of leaking as raw YAML. Keys already shown are skipped;
  // underscores become spaces and the label is uppercased by `eyebrow`.
  const shownKeys = new Set(['file', 'duration', 'speakers', 'roles']);
  const metaEntries: Array<[string, string]> = [
    ['File', fileName],
    ['Duration', duration],
    ['Speakers', speakers],
    ['Generated', todayISO()],
  ];
  for (const [key, val] of Object.entries(front)) {
    if (shownKeys.has(key.toLowerCase())) continue;
    if (!val) continue;
    metaEntries.push([key.replace(/_/g, ' '), val]);
  }
  children.push(metaTable(metaEntries));
  children.push(blank(360));

  // ── Chapter header for the body ──────────────────────────
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [eyebrow('Chapter · Verbatim')],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 80 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: AP.line, space: 4 },
      },
      children: [
        new TextRun({
          text: 'Full Transcript',
          bold: true,
          size: SIZE.h2,
          color: AP.ink,
        }),
      ],
    }),
  );
  children.push(blank(160));

  // ── Body — speaker turns ─────────────────────────────────
  for (const raw of body) {
    if (!raw.trim()) continue;
    const m = TIMESTAMP_RE.exec(raw);
    if (m) {
      const [, ts, speaker, text] = m;
      // Eyebrow line: [hh:mm:ss] · SPEAKER N
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 40 },
          children: [
            new TextRun({
              text: `[${ts}]`,
              bold: true,
              size: SIZE.eyebrow,
              color: AP.amore,
              characterSpacing: 30,
              font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
            }),
            new TextRun({
              text: '   ·   ',
              size: SIZE.eyebrow,
              color: AP.muteSoft,
            }),
            eyebrow(speaker, AP.ink2),
          ],
        }),
      );
      // Body text — line-height ~1.75. Parse inline **bold** so emphasis in the
      // turn text renders instead of showing literal asterisks.
      children.push(
        new Paragraph({
          spacing: { line: 420, lineRule: 'auto', after: 120 },
          children: inlineRuns(text, SIZE.body, AP.ink2),
        }),
      );
    } else {
      children.push(
        new Paragraph({
          spacing: { line: 360, lineRule: 'auto', after: 120 },
          children: inlineRuns(raw, SIZE.body, AP.ink2),
        }),
      );
    }
  }

  // ── Footer rule ──────────────────────────────────────────
  children.push(blank(240));
  children.push(thinRule(AP.line, 80));
  children.push(
    new Paragraph({
      spacing: { before: 60 },
      alignment: AlignmentType.RIGHT,
      children: [eyebrow('End of Transcript', AP.muteSoft)],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            // Per-script font fallback: Pretendard has no Thai glyphs.
            font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
            size: SIZE.body,
            color: AP.ink2,
          },
          paragraph: {
            spacing: { line: 360, lineRule: 'auto' },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
