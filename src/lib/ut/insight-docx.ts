import {
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type FileChild,
  type ITableCellBorders,
} from 'docx';
import type { ClipInsight, InsightSummary } from '@/lib/ut/insight-llm';

// AI UT 인사이트 리포트 — .docx 생성기 (신규 렌더러).
//
// SSOT: design-handoff/artifacts-unified/from-cd/export-documents-BUILD-SPEC.md
//   §1 print translation — 화면 Memphis 시스템은 종이에서 그대로 못 산다:
//     · hard shadow → 제거 (docx 는 그림자 없음)
//     · pastel band → peach 톤 바(정체성만 남김, 잉크 절약)
//     · status badge(색 pill) → 텍스트(메타 셀). 모노 출력에서 색만으론 실패.
//     · body type → 12pt 플로어(종이는 화면보다 멀리서 읽힘)
//     · disabled/estimated(50% opacity) → `~` 프리픽스 + mute 잉크
//   §3.4 UT insight (tone peach ◆):
//     · 클립 = 타임스탬프 + 인용(영상은 인쇄 불가)
//     · 추정치는 `~` 유지
//     · 인용은 verbatim, 따옴표 안
//     · task outcome 을 findings 앞 메타 스트립에
//     · 한 문서 = 한 참여자
//
// pdf 대신 docx: jsPDF 는 CJK 폰트 임베드 없이 한국어 인용문을 tofu 로 그린다
// (§3.4 verbatim-quote 요구 위반 = broken). docx 는 eastAsia:Pretendard 로 한글을
// 정상 렌더한다(전사록·데스크 렌더러와 동일 경로). 스펙이 "pdf(또는 docx)" 를
// 허용하므로 한글-safe 한 docx 를 택함.

const PEACH = 'FFD9BE'; // pastel.peach (tokens.json 2.0) — AI UT 정체성 톤
const PEACH_INK = 'B5764A'; // peach 위 텍스트/글리프용 어두운 peach
const MUTE = '7D7D7D';
const RULE = '111111';
const PAGE_CONTENT_WIDTH_DXA = 9026;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type UtInsightSession = {
  target_url: string | null;
  duration_ms: number | null;
  insight_summary: InsightSummary | null;
  created_at: string | null;
};

export type UtInsightClip = {
  start_ms: number;
  end_ms: number;
  theme: string | null;
  transcript_span: string | null;
  insight: ClipInsight | null;
};

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// §1: pastel band → 얇은 peach 톤 바(정체성만, 잉크 절약).
function toneBar(): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: PEACH },
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: ' ', size: 8 })],
  });
}

// §2/§3: tone dot ◆ + 볼드 타이틀 + 1.6px 잉크 rule.
function sectionHeader(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: RULE } },
    children: [
      new TextRun({ text: '◆ ', color: PEACH_INK }),
      new TextRun({ text: title, bold: true }),
    ],
  });
}

function para(runs: TextRun[], opts?: { spacing?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: opts?.spacing ?? 80 },
    children: runs,
  });
}

const HAIRLINE: ITableCellBorders = {
  top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' },
};

// §3.4: task outcome + duration + clips + date 를 종이-신뢰용 메타 스트립으로.
// status badge(색 pill) 대신 텍스트 셀(§1).
function metaStrip(cells: Array<{ label: string; value: string }>): Table {
  const colW = Math.floor(PAGE_CONTENT_WIDTH_DXA / cells.length);
  return new Table({
    width: { size: PAGE_CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: cells.map(() => colW),
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              width: { size: colW, type: WidthType.DXA },
              borders: HAIRLINE,
              children: [
                new Paragraph({
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: c.label.toUpperCase(),
                      color: MUTE,
                      size: 14,
                      font: 'JetBrains Mono',
                    }),
                  ],
                }),
                new Paragraph({
                  children: [new TextRun({ text: c.value || '—' })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

export async function utInsightToDocx(
  session: UtInsightSession,
  clips: UtInsightClip[],
): Promise<Buffer> {
  const summary = session.insight_summary;
  const children: FileChild[] = [];

  // ── Masthead (p1) ──────────────────────────────────────────────────────
  children.push(toneBar());
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: '◆ AI UT',
          color: PEACH_INK,
          bold: true,
          size: 16,
          font: 'JetBrains Mono',
        }),
        new TextRun({ text: '   ·   Research Canvas', color: MUTE, size: 16 }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: session.target_url?.trim() || 'UT Insight Report',
          bold: true,
        }),
      ],
    }),
  );

  // ── Metadata strip (§3.4: task outcome before findings) ─────────────────
  const durationMin =
    session.duration_ms != null && session.duration_ms > 0
      ? `${Math.round(session.duration_ms / 60000)} min`
      : '—';
  children.push(
    metaStrip([
      { label: 'Task outcome', value: summary?.task_outcome?.trim() || '—' },
      { label: 'Duration', value: durationMin },
      { label: 'Clips', value: String(clips.length) },
      { label: 'Date', value: fmtDate(session.created_at) },
    ]),
  );
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  // ── Overview (§4: 없으면 섹션째 생략) ───────────────────────────────────
  if (summary?.overview?.trim()) {
    children.push(sectionHeader('Overview'));
    children.push(para([new TextRun({ text: summary.overview.trim() })]));
  }

  // ── Key themes ──────────────────────────────────────────────────────────
  if (summary?.key_themes?.length) {
    children.push(sectionHeader('Key themes'));
    for (const t of summary.key_themes) {
      children.push(
        para([
          new TextRun({ text: `${t.theme}`, bold: true }),
          ...(t.detail ? [new TextRun({ text: ` — ${t.detail}` })] : []),
        ]),
      );
    }
  }

  // ── Key frictions (synthesized) ─────────────────────────────────────────
  if (summary?.top_frictions?.length) {
    children.push(sectionHeader('Key frictions'));
    for (const f of summary.top_frictions) {
      const ref =
        f.clip_index != null ? ` (clip ${f.clip_index + 1})` : '';
      children.push(
        para([
          new TextRun({ text: `${f.title}`, bold: true }),
          ...(f.detail ? [new TextRun({ text: ` — ${f.detail}` })] : []),
          ...(ref ? [new TextRun({ text: ref, color: MUTE, size: 18 })] : []),
        ]),
      );
    }
  }

  // ── Moments (§3.4: 클립 = 타임스탬프 + verbatim 인용 + 관찰) ─────────────
  if (clips.length > 0) {
    children.push(sectionHeader('Moments'));
    clips.forEach((clip, i) => {
      const stamp = `${mmss(clip.start_ms)}–${mmss(clip.end_ms)}`;
      children.push(
        para(
          [
            new TextRun({
              text: `clip ${i + 1} · ${stamp}`,
              font: 'JetBrains Mono',
              size: 18,
              color: MUTE,
            }),
            ...(clip.theme
              ? [new TextRun({ text: `   ${clip.theme}`, bold: true })]
              : []),
          ],
          { spacing: 20 },
        ),
      );
      const quote = clip.insight?.quote?.trim();
      if (quote) {
        // §3.4: 인용은 verbatim, 따옴표 안.
        children.push(
          para([new TextRun({ text: `“${quote}”`, italics: true })], {
            spacing: 20,
          }),
        );
      }
      const observation = clip.insight?.summary?.trim();
      if (observation) {
        children.push(para([new TextRun({ text: observation })], { spacing: 20 }));
      }
      const friction = clip.insight?.friction?.trim();
      const severity = clip.insight?.severity;
      const notes: TextRun[] = [];
      if (friction) notes.push(new TextRun({ text: friction, color: MUTE }));
      if (severity) {
        // §1/§3.4: 추정 신호는 `~` + mute 잉크(색 pill 아님).
        notes.push(
          new TextRun({
            text: `${friction ? '  ·  ' : ''}~${severity} severity`,
            color: MUTE,
            size: 18,
          }),
        );
      }
      if (notes.length > 0) children.push(para(notes, { spacing: 160 }));
      else children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    });
  }

  // ── Notable quotes (§3.4: verbatim, 따옴표) ─────────────────────────────
  if (summary?.notable_quotes?.length) {
    children.push(sectionHeader('Notable quotes'));
    for (const q of summary.notable_quotes) {
      if (!q.quote?.trim()) continue;
      const ref = q.clip_index != null ? `  — clip ${q.clip_index + 1}` : '';
      children.push(
        para([
          new TextRun({ text: `“${q.quote.trim()}”`, italics: true }),
          ...(ref ? [new TextRun({ text: ref, color: MUTE, size: 18 })] : []),
        ]),
      );
    }
  }

  const title = session.target_url?.trim() || 'UT Insight Report';
  const generated = fmtDate(session.created_at);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            // eastAsia:Pretendard 로 한국어 인용문 정상 렌더(§5.5 폰트 요건).
            font: { ascii: 'Inter', cs: 'Sarabun', eastAsia: 'Pretendard' },
            size: 24, // 12pt 본문 플로어(§1)
          },
        },
      },
    },
    sections: [
      {
        properties: {},
        // §2: running header p2+ (masthead 는 title 이 크게, header 는 작게).
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
                },
                children: [
                  new TextRun({ text: '◆ ', color: PEACH_INK, size: 16 }),
                  new TextRun({ text: title, size: 16, color: MUTE }),
                  new TextRun({ text: '   ·   AI UT', size: 16, color: MUTE }),
                ],
              }),
            ],
          }),
        },
        // §2: footer — generated date + product (left), N / total (right).
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
                },
                tabStops: [
                  { type: TabStopType.RIGHT, position: PAGE_CONTENT_WIDTH_DXA },
                ],
                children: [
                  new TextRun({
                    text: `${generated ? `${generated} · ` : ''}Research Canvas`,
                    size: 16,
                    color: MUTE,
                  }),
                  new TextRun({ text: '\t', size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTE }),
                  new TextRun({ text: ' / ', size: 16, color: MUTE }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: MUTE }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export { DOCX_MIME as UT_DOCX_MIME };
