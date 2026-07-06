import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  TableLayoutType,
  WidthType,
  BorderStyle,
  type FileChild,
} from 'docx';

// A4/Letter 기본 여백(1인치) 기준 페이지 본문 폭(twips). 표를 이 폭에 균등
// 분배해 채운다 — WidthType.AUTO 는 Word 가 컬럼을 내용 최소폭으로 접어
// 텍스트가 뭉개지므로 쓰지 않는다.
const TABLE_CONTENT_WIDTH_DXA = 9026;

// Inline markdown parser — handles `**bold**`, `*italic*`, `` `code` ``, and
// `[label](url)` links. Returns docx runs in document order. Good enough for
// the desk-research summary's flat prose; not a full CommonMark.
type Inline =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { kind: 'link'; url: string; label: string };

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  let bold = false;
  let italic = false;

  const flush = () => {
    if (buf) {
      out.push({ kind: 'text', text: buf, bold, italic });
      buf = '';
    }
  };

  while (i < line.length) {
    // Link: [label](url)
    if (line[i] === '[') {
      const close = line.indexOf('](', i);
      if (close > -1) {
        const end = line.indexOf(')', close + 2);
        if (end > -1) {
          flush();
          out.push({
            kind: 'link',
            label: line.slice(i + 1, close),
            url: line.slice(close + 2, end),
          });
          i = end + 1;
          continue;
        }
      }
    }
    // Bold: **text**
    if (line[i] === '*' && line[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    // Italic: *text* (when not part of **)
    if (line[i] === '*') {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    // Inline code: `text`
    if (line[i] === '`') {
      flush();
      const end = line.indexOf('`', i + 1);
      if (end > -1) {
        out.push({ kind: 'text', text: line.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    buf += line[i];
    i += 1;
  }
  flush();
  return out;
}

export function inlineToRuns(inlines: Inline[]): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const it of inlines) {
    if (it.kind === 'link') {
      out.push(
        new ExternalHyperlink({
          link: it.url,
          children: [
            new TextRun({
              text: it.label,
              style: 'Hyperlink',
              color: '1F5795',
              underline: {},
            }),
          ],
        }),
      );
    } else {
      out.push(
        new TextRun({
          text: it.text,
          bold: it.bold,
          italics: it.italic,
          font: it.code ? 'JetBrains Mono' : undefined,
          color: it.code ? '7D7D7D' : undefined,
        }),
      );
    }
  }
  return out;
}

// Split a markdown table row `| a | b | c |` into its cell strings. Empty
// leading/trailing pipes are dropped so the cell list matches the visible
// columns. Returns null if the line isn't pipe-fenced — caller treats that
// as "not a table row".
function parseTableRowCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|\s*$/, '');
  return inner.split('|').map((c) => c.trim());
}

// A table separator row looks like `| --- | :---: | ---: |` — each cell is
// dashes with optional leading/trailing colons (for alignment).
function isTableSeparatorCells(cells: string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s+/g, '')))
  );
}

function inlineToRunsWithBoldOverride(
  inlines: Inline[],
  forceBold: boolean,
): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const it of inlines) {
    if (it.kind === 'link') {
      out.push(
        new ExternalHyperlink({
          link: it.url,
          children: [
            new TextRun({
              text: it.label,
              style: 'Hyperlink',
              color: '1F5795',
              underline: {},
              bold: forceBold || undefined,
            }),
          ],
        }),
      );
    } else {
      out.push(
        new TextRun({
          text: it.text,
          bold: forceBold || it.bold,
          italics: it.italic,
          font: it.code ? 'JetBrains Mono' : undefined,
          color: it.code ? '7D7D7D' : undefined,
        }),
      );
    }
  }
  return out;
}

function makeTableCell(
  text: string,
  header: boolean,
  widthDxa: number,
): TableCell {
  return new TableCell({
    // 명시적 DXA 폭 + FIXED 레이아웃(아래)이라야 Word 가 컬럼을 이 폭으로
    // 잡고 그 안에서 텍스트를 wrap 한다. AUTO 면 내용 최소폭으로 접힌다.
    width: { size: widthDxa, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: inlineToRunsWithBoldOverride(parseInline(text), header),
      }),
    ],
  });
}

export function buildTable(headerCells: string[], bodyRows: string[][]): Table {
  const colCount = Math.max(1, headerCells.length);
  // 페이지 본문 폭을 컬럼 수로 균등 분배(twips). 컬럼별 명시 폭 + FIXED
  // 레이아웃으로 표가 페이지 폭을 꽉 채우고, 텍스트는 컬럼 폭 안에서 wrap 된다.
  const colW = Math.floor(TABLE_CONTENT_WIDTH_DXA / colCount);
  const columnWidths = Array.from({ length: colCount }, () => colW);

  const rows: TableRow[] = [];
  rows.push(
    new TableRow({
      tableHeader: true,
      children: headerCells.map((c) => makeTableCell(c, true, colW)),
    }),
  );
  for (const body of bodyRows) {
    // Normalize cell count — pad or truncate to match the header so docx
    // doesn't render misaligned rows.
    const padded = [...body];
    while (padded.length < colCount) padded.push('');
    padded.length = colCount;
    rows.push(
      new TableRow({
        children: padded.map((c) => makeTableCell(c, false, colW)),
      }),
    );
  }
  const thin = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
  return new Table({
    width: { size: TABLE_CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows,
    borders: {
      top: thin,
      bottom: thin,
      left: thin,
      right: thin,
      insideHorizontal: thin,
      insideVertical: thin,
    },
  });
}

export async function deskMarkdownToDocx(
  markdown: string,
  title?: string,
): Promise<Buffer> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const children: FileChild[] = [];

  if (title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, bold: true })],
      }),
    );
  }

  // Pre-scan for tables: a header line (pipe-fenced) immediately followed by
  // a separator line marks a table that extends as long as subsequent lines
  // stay pipe-fenced. Outside that, fall back to per-line handling.
  let idx = 0;
  while (idx < lines.length) {
    const raw = lines[idx];
    const line = raw.replace(/\s+$/, '');

    // Table detection
    const headerCells = parseTableRowCells(line);
    const nextLine = idx + 1 < lines.length ? lines[idx + 1].replace(/\s+$/, '') : '';
    const nextCells = parseTableRowCells(nextLine);
    if (headerCells && nextCells && isTableSeparatorCells(nextCells)) {
      const bodyRows: string[][] = [];
      let j = idx + 2;
      while (j < lines.length) {
        const rowLine = lines[j].replace(/\s+$/, '');
        const rowCells = parseTableRowCells(rowLine);
        if (!rowCells) break;
        bodyRows.push(rowCells);
        j += 1;
      }
      children.push(buildTable(headerCells, bodyRows));
      // Blank paragraph after table for readability.
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      idx = j;
      continue;
    }

    if (!line.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      idx += 1;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const heading =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : level === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
      children.push(
        new Paragraph({
          heading,
          children: inlineToRuns(parseInline(text)),
        }),
      );
      idx += 1;
      continue;
    }

    // Bulleted list (`- ` or `* `)
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineToRuns(parseInline(b[1])),
        }),
      );
      idx += 1;
      continue;
    }

    // Numbered list (`1. `)
    const n = line.match(/^\s*\d+\.\s+(.*)$/);
    if (n) {
      children.push(
        new Paragraph({
          numbering: { reference: 'desk-numbering', level: 0 },
          children: inlineToRuns(parseInline(n[1])),
        }),
      );
      idx += 1;
      continue;
    }

    // Plain paragraph
    children.push(
      new Paragraph({ children: inlineToRuns(parseInline(line)) }),
    );
    idx += 1;
  }

  const doc = new Document({
    styles: {
      default: {
        // Per-script font fallback: Pretendard has no Thai glyphs, so Latin
        // uses Inter and complex scripts (Thai/Arabic) use Sarabun. CJK keeps
        // Pretendard.
        document: {
          run: {
            font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
            size: 22,
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'desk-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: 'left',
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}
