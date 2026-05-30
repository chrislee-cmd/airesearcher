// AI 동시통역 — bilingual transcript renderers.
//
// Reads `translate_messages` rows for a session and produces:
//   - `.txt` (plain text, bilingual interleaved by timestamp)
//   - `.docx` (editorial design-system layout, mirrors transcripts/docx.ts)
//
// Both formats are generated on-demand by the download API route — we do
// NOT store them in Supabase Storage. The source rows are the SSOT;
// caching the rendered artefacts would just create drift.
//
// Localization: tag labels follow the host's UI locale. Korean uses
// `[원문]` / `[통역]`; every other locale falls back to `[source]` /
// `[output]` to keep the plain-text file legible on systems without CJK
// fonts.
//
// The `.docx` template reuses the design tokens from
// `src/lib/transcripts/docx.ts` (1px amore accent, UPPERCASE eyebrow,
// Pretendard / Sarabun / Inter font fallback).

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

export type TranscriptMessage = {
  kind: 'input' | 'output';
  text: string;
  lang: string | null;
  ts: string; // ISO timestamp
};

export type TranscriptMeta = {
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  startedAt: string | null; // ISO. Falls back to first-message ts when null.
  locale: 'ko' | 'en' | 'ja' | 'th';
};

const TAG_LABELS: Record<
  'ko' | 'en' | 'ja' | 'th',
  { input: string; output: string }
> = {
  ko: { input: '원문', output: '통역' },
  en: { input: 'source', output: 'output' },
  ja: { input: 'source', output: 'output' },
  th: { input: 'source', output: 'output' },
};

const FILE_HEADERS: Record<
  'ko' | 'en' | 'ja' | 'th',
  { title: string; session: string; date: string; langs: string }
> = {
  ko: {
    title: 'Research-mochi 동시통역 전사록',
    session: '세션',
    date: '날짜',
    langs: '원어 → 번역',
  },
  en: {
    title: 'Research-mochi Translate Transcript',
    session: 'Session',
    date: 'Date',
    langs: 'Source → Target',
  },
  ja: {
    title: 'Research-mochi 同時通訳 文字起こし',
    session: 'セッション',
    date: '日付',
    langs: '原語 → 翻訳',
  },
  th: {
    title: 'Research-mochi บันทึกการแปลสด',
    session: 'เซสชัน',
    date: 'วันที่',
    langs: 'ภาษาต้นทาง → ปลายทาง',
  },
};

function offsetFromStart(
  rowTs: string,
  startMs: number,
): string {
  const t = Date.parse(rowTs);
  const offsetMs = Number.isFinite(t) ? Math.max(0, t - startMs) : 0;
  const sec = Math.floor(offsetMs / 1000);
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveStartMs(
  meta: TranscriptMeta,
  messages: TranscriptMessage[],
): number {
  if (meta.startedAt) {
    const t = Date.parse(meta.startedAt);
    if (Number.isFinite(t)) return t;
  }
  if (messages.length > 0) {
    const t = Date.parse(messages[0].ts);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

/**
 * Plain-text bilingual transcript.
 *
 * Lines are interleaved by their ts column (the host's broadcast order)
 * with a fixed-width tag column so the file scans nicely in a text editor.
 */
export function renderTranslateTranscriptText(
  meta: TranscriptMeta,
  messages: TranscriptMessage[],
): string {
  const tags = TAG_LABELS[meta.locale];
  const header = FILE_HEADERS[meta.locale];
  const startMs = resolveStartMs(meta, messages);

  const lines: string[] = [];
  lines.push(`# ${header.title}`);
  lines.push(`${header.session}: ${meta.sessionId}`);
  lines.push(`${header.date}: ${todayISO()}`);
  lines.push(`${header.langs}: ${meta.sourceLang} → ${meta.targetLang}`);
  lines.push('');

  for (const m of messages) {
    const stamp = offsetFromStart(m.ts, startMs);
    const tag = m.kind === 'input' ? tags.input : tags.output;
    // Pad tag column so visual scan picks out alternation at a glance.
    // Korean tags can be longer (2-char hangul), so we pad to 8 cols
    // regardless of locale.
    const padded = `[${tag}]`.padEnd(8, ' ');
    lines.push(`[${stamp}] ${padded} ${m.text}`);
  }

  if (messages.length === 0) {
    lines.push(meta.locale === 'ko' ? '(전사록이 비어 있습니다)' : '(transcript is empty)');
  }

  return lines.join('\n') + '\n';
}

// ── docx design tokens (mirrors src/lib/transcripts/docx.ts) ──
const AP = {
  amore: '1F5795',
  ink: '000000',
  ink2: '1A1A1A',
  mute: '5A5A5A',
  muteSoft: '9B9B9B',
  line: 'E1E3E8',
} as const;

// docx sizes are in half-points.
const SIZE = {
  h1: 72, // 36pt
  h2: 40, // 20pt
  subtitle: 22, // 11pt
  eyebrow: 18, // 9pt UPPERCASE
  body: 25, // 12.5pt
  tag: 18, // 9pt
} as const;

function eyebrow(text: string, color: string = AP.amore): TextRun {
  return new TextRun({
    text: text.toUpperCase(),
    bold: true,
    size: SIZE.eyebrow,
    color,
    characterSpacing: 40,
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

/**
 * Editorial docx transcript. Same content as the .txt format but rendered
 * through the design system (cover eyebrow, 1px amore rule, paragraph
 * layout with kind/timestamp eyebrow lines).
 */
export async function renderTranslateTranscriptDocx(
  meta: TranscriptMeta,
  messages: TranscriptMessage[],
): Promise<Buffer> {
  const tags = TAG_LABELS[meta.locale];
  const header = FILE_HEADERS[meta.locale];
  const startMs = resolveStartMs(meta, messages);

  const children: Array<Paragraph> = [];

  // Cover
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
      children: [eyebrow('Translate · Bilingual')],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: header.title,
          bold: true,
          size: SIZE.h1,
          color: AP.ink,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${header.langs}: ${meta.sourceLang} → ${meta.targetLang}`,
          size: SIZE.subtitle,
          color: AP.mute,
          characterSpacing: 30,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `${header.session}: ${meta.sessionId}`,
          size: SIZE.subtitle,
          color: AP.muteSoft,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: `${header.date}: ${todayISO()}`,
          size: SIZE.subtitle,
          color: AP.muteSoft,
        }),
      ],
    }),
  );

  // Chapter
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

  if (messages.length === 0) {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text:
              meta.locale === 'ko'
                ? '(전사록이 비어 있습니다)'
                : '(transcript is empty)',
            size: SIZE.body,
            color: AP.muteSoft,
            italics: true,
          }),
        ],
      }),
    );
  }

  for (const m of messages) {
    const stamp = offsetFromStart(m.ts, startMs);
    const tag = m.kind === 'input' ? tags.input : tags.output;
    const tagColor = m.kind === 'input' ? AP.muteSoft : AP.amore;
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 30 },
        children: [
          new TextRun({
            text: `[${stamp}]`,
            bold: true,
            size: SIZE.tag,
            color: AP.amore,
            characterSpacing: 30,
            font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
          }),
          new TextRun({
            text: '   ·   ',
            size: SIZE.tag,
            color: AP.muteSoft,
          }),
          eyebrow(tag, tagColor),
        ],
      }),
    );
    children.push(
      new Paragraph({
        spacing: { line: 360, lineRule: 'auto', after: 80 },
        children: [
          new TextRun({
            text: m.text,
            size: SIZE.body,
            color: m.kind === 'input' ? AP.ink2 : AP.ink,
          }),
        ],
      }),
    );
  }

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
