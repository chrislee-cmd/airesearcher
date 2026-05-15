import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  type Table,
  TextRun,
} from 'docx';
import type {
  AnalysisResult,
  ConsolidatedInsight,
  OutlierCase,
  RowSummary,
} from '@/components/interview-job-provider';

// Design system tokens — mirrors transcripts/docx.ts so the two
// generated documents share an editorial look. Sizes in half-points;
// line spacing in 240ths (240 = 1.0).
const AP = {
  amore: '1F5795',
  ink: '000000',
  ink2: '1A1A1A',
  mute: '5A5A5A',
  muteSoft: '9B9B9B',
  line: 'E1E3E8',
} as const;

const SIZE = {
  h1: 72,
  h2: 36,
  h3: 26,
  subtitle: 22,
  eyebrow: 18,
  body: 24,
  caption: 20,
} as const;

const FONT = {
  ascii: 'Inter',
  cs: 'Sarabun',
  eastAsia: 'Pretendard',
} as const;

function eyebrow(text: string, color: string = AP.amore): TextRun {
  return new TextRun({
    text: text.toUpperCase(),
    bold: true,
    size: SIZE.eyebrow,
    color,
    characterSpacing: 40,
    font: FONT,
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

function bodyParagraph(text: string, after = 120): Paragraph {
  return new Paragraph({
    spacing: { line: 360, lineRule: 'auto', after },
    children: [new TextRun({ text, size: SIZE.body, color: AP.ink2 })],
  });
}

function outlierItem(outlier: OutlierCase): Paragraph {
  const tag =
    outlier.filenames.length > 0
      ? `   — ${outlier.filenames.join(', ')}`
      : '';
  return new Paragraph({
    spacing: { line: 320, lineRule: 'auto', after: 80 },
    indent: { left: 200 },
    children: [
      new TextRun({
        text: `• ${outlier.description}`,
        size: SIZE.body,
        color: AP.ink2,
      }),
      ...(tag
        ? [
            new TextRun({
              text: tag,
              size: SIZE.caption,
              color: AP.muteSoft,
            }),
          ]
        : []),
    ],
  });
}

function vocItem(voc: string, filename: string): Paragraph {
  return new Paragraph({
    spacing: { line: 320, lineRule: 'auto', after: 80 },
    indent: { left: 200 },
    children: [
      new TextRun({
        text: `“${voc}”`,
        italics: true,
        size: SIZE.body,
        color: AP.mute,
      }),
      new TextRun({
        text: `   — ${filename}`,
        size: SIZE.caption,
        color: AP.muteSoft,
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

function consolidatedSection(
  insights: ConsolidatedInsight[],
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  out.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [eyebrow('Chapter · Consolidated Insights')],
    }),
  );
  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: AP.line, space: 4 },
      },
      children: [
        new TextRun({
          text: '최종 요약',
          bold: true,
          size: SIZE.h2,
          color: AP.ink,
        }),
      ],
    }),
  );

  insights.forEach((insight, idx) => {
    if (idx > 0) out.push(blank(120));
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          eyebrow(`Insight ${String(idx + 1).padStart(2, '0')}`, AP.muteSoft),
        ],
      }),
    );
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: insight.topic,
            bold: true,
            size: SIZE.h3,
            color: AP.ink2,
          }),
        ],
      }),
    );
    if (insight.sourceIndices.length > 1) {
      out.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `${insight.sourceIndices.length}개 문항 융합`,
              size: SIZE.caption,
              color: AP.muteSoft,
              characterSpacing: 30,
            }),
          ],
        }),
      );
    }
    if (insight.mainstream && insight.mainstream.trim()) {
      out.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [eyebrow('대표 경향성', AP.amore)],
        }),
      );
      for (const line of insight.mainstream.split(/\r?\n/)) {
        if (line.trim()) out.push(bodyParagraph(line));
      }
      if (insight.mainstreamVocs.length > 0) {
        out.push(blank(60));
        out.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [eyebrow('대표 VOC', AP.muteSoft)],
          }),
        );
        for (const v of insight.mainstreamVocs) {
          out.push(vocItem(v.voc, v.filename));
        }
      }
    }
    if (insight.outliers.length > 0) {
      out.push(blank(80));
      out.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [eyebrow('소수 케이스', AP.muteSoft)],
        }),
      );
      for (const o of insight.outliers) {
        out.push(outlierItem(o));
      }
      if (insight.outlierVocs.length > 0) {
        out.push(blank(60));
        out.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [eyebrow('소수 케이스 VOC', AP.muteSoft)],
          }),
        );
        for (const v of insight.outlierVocs) {
          out.push(vocItem(v.voc, v.filename));
        }
      }
    }
  });
  return out;
}

function rowSummaryParagraphs(summary: RowSummary): Array<Paragraph> {
  const out: Paragraph[] = [];
  if (summary.mainstream && summary.mainstream.trim()) {
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [eyebrow('대표 경향성', AP.amore)],
      }),
    );
    for (const line of summary.mainstream.split(/\r?\n/)) {
      if (line.trim()) out.push(bodyParagraph(line));
    }
  }
  if (summary.outliers.length > 0) {
    out.push(blank(60));
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [eyebrow('소수 케이스', AP.muteSoft)],
      }),
    );
    for (const o of summary.outliers) {
      out.push(outlierItem(o));
    }
  }
  return out;
}

function matrixSection(
  result: AnalysisResult,
  filenameOrder: string[],
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  out.push(blank(360));
  out.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [eyebrow('Chapter · Respondent Matrix')],
    }),
  );
  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: AP.line, space: 4 },
      },
      children: [
        new TextRun({
          text: '응답자별 매트릭스',
          bold: true,
          size: SIZE.h2,
          color: AP.ink,
        }),
      ],
    }),
  );

  for (const row of result.rows) {
    const cellsByFile = new Map(row.cells.map((c) => [c.filename, c]));
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: row.question,
            bold: true,
            size: SIZE.h3,
            color: AP.ink2,
          }),
        ],
      }),
    );
    const hasMainstream =
      !!row.summary?.mainstream && row.summary.mainstream.trim().length > 0;
    const hasOutliers = (row.summary?.outliers.length ?? 0) > 0;
    if (row.summary && (hasMainstream || hasOutliers)) {
      out.push(...rowSummaryParagraphs(row.summary));
    }
    const hasAnyVoc = filenameOrder.some((f) => cellsByFile.get(f)?.voc);
    if (hasAnyVoc) {
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [eyebrow('Verbatim', AP.muteSoft)],
        }),
      );
      for (const f of filenameOrder) {
        const c = cellsByFile.get(f);
        if (c?.voc) out.push(vocItem(c.voc, f));
      }
    }
  }
  return out;
}

export async function buildInterviewDocxBlob(
  result: AnalysisResult,
  filenameOrder: string[],
): Promise<Blob> {
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
      children: [eyebrow('Interview · Analysis Result')],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: '인터뷰 분석',
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
          text: `RESPONDENTS · ${filenameOrder.length}   ·   GENERATED · ${todayISO()}`,
          size: SIZE.subtitle,
          color: AP.mute,
          characterSpacing: 30,
        }),
      ],
    }),
  );

  const hasConsolidated =
    !!result.consolidated && result.consolidated.length > 0;
  if (hasConsolidated) {
    children.push(...consolidatedSection(result.consolidated!));
  }
  if (result.rows.length > 0) {
    children.push(...matrixSection(result, filenameOrder));
  }

  children.push(blank(240));
  children.push(thinRule(AP.line, 80));
  children.push(
    new Paragraph({
      spacing: { before: 60 },
      alignment: AlignmentType.RIGHT,
      children: [eyebrow('End of Analysis', AP.muteSoft)],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
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

  return Packer.toBlob(doc);
}
