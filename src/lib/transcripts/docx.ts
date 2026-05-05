import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

const TIMESTAMP_RE = /^\[(\d{2}:\d{2}:\d{2})\]\s+([^:]+):\s*(.*)$/;

/**
 * Convert our transcript markdown (front matter + `[hh:mm:ss] Speaker N: text`
 * lines) into a docx Buffer. Front matter becomes a small metadata block,
 * each timestamped line becomes a paragraph with a bold timestamp + speaker
 * tag and regular body text.
 */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const lines = markdown.split(/\r?\n/);

  // Split YAML front matter from body
  const frontMatter: string[] = [];
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
      frontMatter.push(line);
    } else {
      body.push(line);
    }
  }

  const children: Paragraph[] = [];

  // Title from `file:` if present
  const fileLine = frontMatter.find((l) => l.startsWith('file:'));
  if (fileLine) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: fileLine.replace('file:', '').trim() })],
      }),
    );
  }

  // Other front-matter rows as a metadata block
  for (const fm of frontMatter) {
    if (!fm.trim() || fm.startsWith('file:')) continue;
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: fm.trim(), italics: true, color: '7d7d7d' }),
        ],
      }),
    );
  }
  if (frontMatter.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  }

  // Body
  for (const raw of body) {
    if (!raw.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      continue;
    }
    const m = TIMESTAMP_RE.exec(raw);
    if (m) {
      const [, ts, speaker, text] = m;
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `[${ts}] `, bold: true, color: '1F5795' }),
            new TextRun({ text: `${speaker}: `, bold: true }),
            new TextRun({ text }),
          ],
        }),
      );
    } else {
      children.push(
        new Paragraph({ children: [new TextRun({ text: raw })] }),
      );
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          // Per-script font fallback: Pretendard has no Thai glyphs.
          run: {
            font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
            size: 22,
          },
        },
      },
    },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}
