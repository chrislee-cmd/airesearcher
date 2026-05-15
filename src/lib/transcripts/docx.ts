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

const TIMESTAMP_RE = /^\[(\d{2}:\d{2}:\d{2})\]\s+([^:]+):\s*(.*)$/;

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

function metaTable(entries: Array<[string, string]>): Table {
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
    rows: [
      new TableRow({
        children: entries.map(([k, v]) => metaCell(k, v)),
      }),
    ],
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

  // Split YAML front matter from body
  const front: Record<string, string> = {};
  const body: string[] = [];
  let inFront = false;
  let frontDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFront = true;
      continue;
    }
    if (inFront && !frontDone && line.trim() === '---') {
      frontDone = true;
      inFront = false;
      continue;
    }
    if (inFront) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key) front[key] = val;
      }
    } else {
      body.push(line);
    }
  }

  const fileName = front.file ?? 'Transcript';
  const duration = front.duration ?? '—';
  const speakers = front.speakers ?? '—';

  const children: Array<Paragraph | Table> = [];

  // ── Cover ────────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [eyebrow('Research-mochi', AP.muteSoft)],
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

  children.push(
    metaTable([
      ['File', fileName],
      ['Duration', duration],
      ['Speakers', speakers],
      ['Generated', todayISO()],
    ]),
  );
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
      // Body text — line-height ~1.75
      children.push(
        new Paragraph({
          spacing: { line: 420, lineRule: 'auto', after: 120 },
          children: [
            new TextRun({
              text,
              size: SIZE.body,
              color: AP.ink2,
            }),
          ],
        }),
      );
    } else {
      children.push(
        new Paragraph({
          spacing: { line: 360, lineRule: 'auto', after: 120 },
          children: [
            new TextRun({
              text: raw,
              size: SIZE.body,
              color: AP.ink2,
            }),
          ],
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
