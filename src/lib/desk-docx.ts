import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
} from 'docx';

// Inline markdown parser — handles `**bold**`, `*italic*`, `` `code` ``, and
// `[label](url)` links. Returns docx runs in document order. Good enough for
// the desk-research summary's flat prose; not a full CommonMark.
type Inline =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { kind: 'link'; url: string; label: string };

function parseInline(line: string): Inline[] {
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

function inlineToRuns(inlines: Inline[]): (TextRun | ExternalHyperlink)[] {
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

export async function deskMarkdownToDocx(
  markdown: string,
  title?: string,
): Promise<Buffer> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const children: Paragraph[] = [];

  if (title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, bold: true })],
      }),
    );
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
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
      continue;
    }

    // Plain paragraph
    children.push(
      new Paragraph({ children: inlineToRuns(parseInline(line)) }),
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Pretendard', size: 22 } },
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
