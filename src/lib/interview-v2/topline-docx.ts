// 인터뷰 탑라인 보고서 — 블록 배열 → Word(.docx) 변환.
//
// desk-research 의 desk-docx.ts 파이프라인(같은 docx 라이브러리 · 폰트 폴백 ·
// inline markdown 파서 · 표 빌더)을 재사용한다. 차이는 입력이 markdown 문자열이
// 아니라 구조화된 ToplineBlock[] 이라는 점 — 그래서 블록 타입별로 스타일을 직접
// 매핑한다(heading/quote/table/inserted_qa 가 각각 다른 톤).
//
// 인용 처리(사용자 결정 3): 블록의 citations 는 chunk_id 문자열이고 md 본문에도
// inline [chunk_id] 토큰이 섞여 있다. 사람이 읽는 문서이므로 raw chunk_id 를
// **절대 노출하지 않는다** — inline 토큰은 제거하고, 블록 끝에 "근거: 문서명"
// 형태로 출처 문서명만 표기한다(chunk_id → filename 은 route 가 미리 해석해
// sources 맵으로 넘긴다).

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  TableBorders,
  TableLayoutType,
  WidthType,
  ShadingType,
  VerticalAlign,
  type FileChild,
} from 'docx';
import { parseInline, inlineToRuns } from '@/lib/desk-docx';
import type { ToplineBlock } from '@/lib/interview-v2/topline';

export type CitationSource = { filename: string };

export type ToplineDocxOptions = {
  projectName: string;
  // interview_toplines.generated_at (ISO). 표지 "생성일" 에 쓰인다. 없으면 오늘.
  generatedAt?: string | null;
  // chunk_id → 출처 문서. inline chunk_id 대신 사람이 읽는 "근거: 파일명" 을
  // 렌더하는 데 쓴다. 맵에 없는 id 는 조용히 생략(raw 노출 절대 없음).
  sources: Map<string, CitationSource>;
};

const NUMBERING_REF = 'topline-numbering';
// 말미 "근거 문서" 인덱스 전용 numbering — 본문 번호 리스트(NUMBERING_REF)와 카운터를
// 분리해 인덱스가 항상 1..N 으로 시작하게 한다.
const SOURCE_NUMBERING_REF = 'topline-source-index';

// 차트 팔레트 — 렌더러(topline-blocks/report-chart)의 TOPLINE_CHART_COLORS 와
// 동일 색을 hex 로 고정한다(docx 는 CSS var 을 못 쓴다). amore=C6613F(인용 보더와
// 동일), ink, mute, orange, purple.
const CHART_PALETTE = ['C6613F', '1A1A1A', '6B7280', 'F97316', 'A855F7'];

// 차트 막대 표의 본문 폭(desk-docx TABLE_CONTENT_WIDTH_DXA 와 동일). 라벨 칸 +
// TICKS 개의 눈금 칸으로 나눠 gridSpan 으로 값 비례 막대를 그린다.
const CHART_TABLE_WIDTH_DXA = 9026;
const CHART_TICKS = 40;

// 좌 amore accent 보더(인용/삽입 계열 공통) — 삽입 섹션이 본문과 시각 구분되게.
const INSERTED_BORDER = {
  left: { style: BorderStyle.SINGLE, size: 12, color: 'C6613F', space: 12 },
} as const;

// chart/pie 블록의 data → 값 비례 가로 막대 표. 서버 rasterizer(canvas/sharp)가
// 없고 constraint 가 "경량 우선/번들 주의"라 이미지 대신 네이티브 Word 표로
// 시각화한다 — 모든 Word/Google Docs 뷰어에서 렌더되고 의존성 0. 라벨(값/비율)은
// 좌 칸 텍스트로, 막대는 팔레트 색 shading 으로 그린다. 데이터가 없으면 null.
function chartBarsTable(block: {
  type: string;
  data?: { label: string; value: number }[];
}): Table | null {
  const data = (block.data ?? []).filter(
    (d) => d && typeof d.value === 'number' && Number.isFinite(d.value),
  );
  if (data.length === 0) return null;

  const isPie = block.type === 'pie';
  const total = data.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  // pie 는 전체 대비 비율로, bar/line 은 최댓값 대비로 막대 길이를 잡는다.
  const denom = (isPie ? total : max) || 1;

  const labelW = 3200;
  const tickW = Math.floor((CHART_TABLE_WIDTH_DXA - labelW) / CHART_TICKS);
  const columnWidths = [labelW, ...Array.from({ length: CHART_TICKS }, () => tickW)];

  const rows = data.map((d, i) => {
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    const v = d.value > 0 ? d.value : 0;
    let filled = v <= 0 ? 0 : Math.max(1, Math.round((v / denom) * CHART_TICKS));
    if (filled > CHART_TICKS) filled = CHART_TICKS;
    const remaining = CHART_TICKS - filled;
    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    const labelText = isPie
      ? `${d.label} · ${d.value} (${pct}%)`
      : `${d.label} · ${d.value}`;

    const cells: TableCell[] = [
      new TableCell({
        width: { size: labelW, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            spacing: { before: 20, after: 20 },
            children: [new TextRun({ text: labelText, size: 18 })],
          }),
        ],
      }),
    ];
    if (filled > 0) {
      cells.push(
        new TableCell({
          columnSpan: filled,
          width: { size: tickW * filled, type: WidthType.DXA },
          shading: { fill: color, type: ShadingType.CLEAR, color: 'auto' },
          children: [new Paragraph({ children: [new TextRun({ text: '', size: 18 })] })],
        }),
      );
    }
    if (remaining > 0) {
      cells.push(
        new TableCell({
          columnSpan: remaining,
          width: { size: tickW * remaining, type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun('')] })],
        }),
      );
    }
    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: CHART_TABLE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
    rows,
  });
}

// inserted_section 본문 프로즈 → 좌 accent 보더 + 들여쓰기 문단(삽입 구분). 산문
// proseParagraphs 와 같은 파싱이되 삽입 시각 표식을 얹는다.
function insertedSectionProse(md: string, citedIds: Set<string>): Paragraph[] {
  const clean = stripInlineCitations(md, citedIds);
  const lines = clean.replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          border: INSERTED_BORDER,
          children: inlineToRuns(parseInline(bullet[1])),
        }),
      );
      continue;
    }
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) {
      out.push(
        new Paragraph({
          numbering: { reference: NUMBERING_REF, level: 0 },
          border: INSERTED_BORDER,
          children: inlineToRuns(parseInline(num[1])),
        }),
      );
      continue;
    }
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        indent: { left: 360 },
        border: INSERTED_BORDER,
        children: inlineToRuns(parseInline(line)),
      }),
    );
  }
  return out;
}

// inline [chunk_id] 인용 토큰 제거 — markdown 링크 [label](url) 는 보존한다.
// 이 블록의 citations 에 실제로 있는 id 만 지워서 일반 [대괄호] 산문은 남긴다.
// 토큰 앞 공백도 같이 정리하고, 그 결과로 구두점 앞에 남는 공백을 붙인다.
function stripInlineCitations(md: string, citedIds: Set<string>): string {
  return md
    .replace(/\s*\[([^\]\n]+)\](?!\()/g, (full, tok: string) =>
      citedIds.has(tok.trim()) ? '' : full,
    )
    .replace(/[ \t]+([.,;:?!、。])/g, '$1');
}

// 블록 citations → 중복 없는 출처 문서명(첫 등장 순서). 맵에 없거나 빈 파일명은
// 건너뛴다.
function citedFilenames(
  citations: string[] | undefined,
  sources: Map<string, CitationSource>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of citations ?? []) {
    const src = sources.get(String(id));
    const name = src?.filename?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// 블록 끝 근거 표기 — 파일명을 나열하지 않고 **"근거 N건"**(중복 제거한 출처
// 문서 수)만 작고 옅은 회색으로 집약한다(§A 최우선 — 근거줄이 본문을 압도하지
// 않게). 상세 파일명은 문서 말미 "근거 문서" 인덱스(sourceIndexSection)에 한 번만
// 모아 추적성(감사)을 유지하되 기본 뷰에서는 접힌다. 출처가 없으면 null.
// i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
function sourceLine(
  citations: string[] | undefined,
  sources: Map<string, CitationSource>,
): Paragraph | null {
  const names = citedFilenames(citations, sources);
  if (names.length === 0) return null;
  return new Paragraph({
    spacing: { before: 20, after: 140 },
    children: [
      new TextRun({
        // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
        text: `근거 ${names.length}건`,
        italics: true,
        color: 'A0A0A0',
        size: 16,
      }),
    ],
  });
}

// 문서 전체 블록에서 인용된 출처 문서명을 첫 등장 순서로 중복 없이 모은다 —
// 표지 메타(응답 문서 수)와 말미 "근거 문서" 인덱스가 공유한다.
function collectAllFilenames(
  blocks: ToplineBlock[],
  sources: Map<string, CitationSource>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    const cits = 'citations' in b ? b.citations : undefined;
    for (const name of citedFilenames(cits, sources)) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

// 문서 말미 "근거 문서" 인덱스 — 본문에서 접은 파일명을 한 번에 번호로 모아
// 추적성(감사)을 유지한다. 전용 numbering(SOURCE_NUMBERING_REF)으로 1..N 부여.
// i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
function sourceIndexSection(filenames: string[]): FileChild[] {
  if (filenames.length === 0) return [];
  const out: FileChild[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'C6613F', space: 6 } },
      // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
      children: [new TextRun({ text: '근거 문서', bold: true, size: 28, color: '1A1A1A' })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
          text: '본문 각 블록의 "근거 N건" 은 아래 문서에서 추출한 것입니다.',
          color: '8A8A8A',
          size: 18,
        }),
      ],
    }),
  ];
  for (const name of filenames) {
    out.push(
      new Paragraph({
        numbering: { reference: SOURCE_NUMBERING_REF, level: 0 },
        spacing: { after: 20 },
        children: [new TextRun({ text: name, size: 20, color: '4A4A4A' })],
      }),
    );
  }
  return out;
}

// 헤딩용 런 — inline markdown(`**`, `*`, `` ` ``) 을 파싱해 raw 토큰 노출을 막고
// (§D), 전 런에 볼드 + 지정 크기/색을 강제해 위계를 준다. 헤딩은 링크가 드물어
// 링크 라벨도 볼드 텍스트로 평탄화한다.
function headingRuns(
  md: string,
  citedIds: Set<string>,
  opts: { size: number; color: string },
): TextRun[] {
  const clean = stripInlineCitations(md, citedIds);
  return parseInline(clean).map((it) =>
    it.kind === 'link'
      ? new TextRun({ text: it.label, bold: true, size: opts.size, color: opts.color })
      : new TextRun({
          text: it.text,
          bold: true,
          italics: it.italic,
          size: opts.size,
          color: opts.color,
        }),
  );
}

// topline 전용 스타일 표 — 공유 buildTable(desk-docx)은 desk export 와 공용이라
// 손대지 않고(웹/desk 회귀 방지), 여기서 헤더행 음영 + 본문 zebra(옅은 교대색) +
// 얇은 보더로 가독성을 올린 표를 별도로 만든다(§C). 셀 inline 인용 토큰 제거는
// 호출측 strip 클로저가 담당한다.
const TABLE_WIDTH_DXA = 9026;
const TABLE_HEADER_FILL = 'F3E9E4'; // accent(C6613F) 옅은 틴트 — 헤더행 구분.
const TABLE_ZEBRA_FILL = 'F7F6F4'; // 본문 교대색(옅은 회색).
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 2, color: 'E0DAD5' } as const;

function styledTable(
  headers: string[],
  rows: string[][],
  strip: (s: string) => string,
): Table {
  const colCount = Math.max(1, headers.length);
  const colW = Math.floor(TABLE_WIDTH_DXA / colCount);
  const columnWidths = Array.from({ length: colCount }, () => colW);

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          width: { size: colW, type: WidthType.DXA },
          shading: { fill: TABLE_HEADER_FILL, type: ShadingType.CLEAR, color: 'auto' },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [new TextRun({ text: strip(h), bold: true, color: '1A1A1A' })],
            }),
          ],
        }),
    ),
  });

  const bodyRows = rows.map((row, ri) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    padded.length = colCount;
    const zebra = ri % 2 === 1;
    return new TableRow({
      children: padded.map(
        (c) =>
          new TableCell({
            width: { size: colW, type: WidthType.DXA },
            shading: zebra
              ? { fill: TABLE_ZEBRA_FILL, type: ShadingType.CLEAR, color: 'auto' }
              : undefined,
            children: [
              new Paragraph({
                spacing: { before: 20, after: 20 },
                children: inlineToRuns(parseInline(strip(c))),
              }),
            ],
          }),
      ),
    });
  });

  return new Table({
    width: { size: TABLE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...bodyRows],
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_BORDER,
      right: TABLE_BORDER,
      insideHorizontal: TABLE_BORDER,
      insideVertical: TABLE_BORDER,
    },
  });
}

// 산문 md → Paragraph[] (불릿 · 번호 · 일반 문단). inline 인용 토큰은 먼저
// 제거한다. paragraph/insight/inserted_qa 답변 본문에 공통으로 쓴다.
function proseParagraphs(md: string, citedIds: Set<string>): Paragraph[] {
  const clean = stripInlineCitations(md, citedIds);
  const lines = clean.replace(/\r\n/g, '\n').split('\n');
  const out: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineToRuns(parseInline(bullet[1])),
        }),
      );
      continue;
    }
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) {
      out.push(
        new Paragraph({
          numbering: { reference: NUMBERING_REF, level: 0 },
          children: inlineToRuns(parseInline(num[1])),
        }),
      );
      continue;
    }
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        children: inlineToRuns(parseInline(line)),
      }),
    );
  }
  return out;
}

function blockToChildren(
  block: ToplineBlock,
  sources: Map<string, CitationSource>,
): FileChild[] {
  const citations = 'citations' in block ? block.citations : undefined;
  const citedIds = new Set((citations ?? []).map((c) => String(c).trim()));

  if (block.type === 'executive_summary') {
    // 보고서 리드 — 요약 문단 + 핵심 포인트 불릿. 근거는 문서 하단 "근거: 문서명"
    // 각주로(raw chunk_id 노출 X). 카드/fullview 와 동일 소스.
    const children: FileChild[] = [];
    if (block.summary?.trim()) {
      children.push(...proseParagraphs(block.summary, citedIds));
    }
    for (const point of block.key_points ?? []) {
      if (!point.trim()) continue;
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: inlineToRuns(parseInline(stripInlineCitations(point, citedIds))),
        }),
      );
    }
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun('')] }));
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  if (block.type === 'heading') {
    // H1(파트) — 큰 잉크색 + 하단 accent 구분선으로 섹션 경계를 뚜렷이(§C).
    // inline md 토큰은 headingRuns 가 파싱 제거(§D).
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 140 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'C6613F', space: 6 } },
        children: headingRuns(block.md ?? '', citedIds, { size: 28, color: '1A1A1A' }),
      }),
    ];
  }

  if (block.type === 'subheading') {
    // H2(서브) — accent 색 + H1 보다 작게 차등해 2단 위계를 만든다(§C).
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 80 },
        children: headingRuns(block.md ?? '', citedIds, { size: 24, color: 'C6613F' }),
      }),
    ];
  }

  if (block.type === 'chart' || block.type === 'pie') {
    // 차트/파이 — 값 비례 가로 막대 표로 시각화(chartBarsTable). 막대 표의 각 행
    // 라벨 칸이 "라벨 · 값(·%)" 텍스트를 이미 담으므로 값이 문서에 항상 남는다
    // → 별도 폴백 불릿 나열은 제거(§B 불릿 덤프 탈피 — 값 중복 노이즈 축소).
    // 서버 rasterizer 부재로 네이티브 Word 표를 택함(경량 우선 constraint).
    const children: FileChild[] = [];
    if (block.title) {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
          children: headingRuns(block.title, citedIds, { size: 22, color: '1A1A1A' }),
        }),
      );
    }
    if (block.description) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: stripInlineCitations(block.description, citedIds).trim(),
              color: '8A8A8A',
              size: 20,
            }),
          ],
        }),
      );
    }
    const chartTable = chartBarsTable(block);
    if (chartTable) children.push(chartTable);
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun('')] }));
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  if (block.type === 'quote') {
    // 인용 스타일 — 들여쓰기 + 이탤릭 + 좌측 accent 보더. 인용문 전체를
    // 이탤릭으로(verbatim 발췌라 원문 강조 파싱 대신 통째로 인용 톤).
    const children: FileChild[] = [
      new Paragraph({
        indent: { left: 480 },
        spacing: { before: 80, after: 40 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: 'C6613F', space: 12 },
        },
        children: [
          new TextRun({
            text: stripInlineCitations(block.md ?? '', citedIds).trim(),
            italics: true,
          }),
        ],
      }),
    ];
    if (block.attribution) {
      children.push(
        new Paragraph({
          indent: { left: 480 },
          spacing: { after: 120 },
          children: [
            new TextRun({ text: `— ${block.attribution}`, color: '8A8A8A', size: 18 }),
          ],
        }),
      );
    }
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  if (block.type === 'table' && block.table) {
    const children: FileChild[] = [];
    if (block.md) {
      // 표 캡션 — inline md 토큰 파싱(§D) + 볼드 소제목 톤.
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: headingRuns(block.md, citedIds, { size: 22, color: '1A1A1A' }),
        }),
      );
    }
    // 셀 안의 inline 인용 토큰도 제거해 raw chunk_id 노출을 막는다.
    const strip = (s: string) => stripInlineCitations(s, citedIds);
    children.push(
      // 헤더 음영 + zebra 본문의 topline 전용 스타일 표(§C). 공유 buildTable 은
      // desk export 와 공용이라 건드리지 않는다.
      styledTable(block.table.headers, block.table.rows, strip),
    );
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun('')] }));
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  if (block.type === 'inserted_qa') {
    // drag-to-ask 로 유지한 Q&A — "Q. …" 볼드 + 답변(구분 스타일). 본문과
    // 구분되도록 질문을 볼드로, 답변을 일반 산문으로 렌더한다.
    const children: FileChild[] = [];
    if (block.question) {
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
          children: [
            new TextRun({ text: 'Q. ', bold: true, color: 'C6613F' }),
            new TextRun({ text: block.question, bold: true }),
          ],
        }),
      );
    }
    if (block.selected_excerpt) {
      children.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 60 },
          children: [
            new TextRun({
              text: `“${block.selected_excerpt}”`,
              italics: true,
              color: '8A8A8A',
              size: 18,
            }),
          ],
        }),
      );
    }
    if (block.md) children.push(...proseParagraphs(block.md, citedIds));
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  if (block.type === 'inserted_section') {
    // 섹션 사이 삽입 UX 로 생성한 섹션 — 렌더러는 좌 amore 보더 + ✚ 칩으로
    // "사용자 삽입"임을 표시한다. Word 에서도 동급으로: ✚ 라벨 + 좌 accent 보더 +
    // 들여쓰기로 본문과 시각 구분(현 default 폴백 제거 — 11종 전수 커버).
    const children: FileChild[] = [];
    children.push(
      new Paragraph({
        spacing: { before: 160, after: 40 },
        indent: { left: 360 },
        border: INSERTED_BORDER,
        children: [
          // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
          new TextRun({ text: '✚ 삽입 섹션', bold: true, color: 'C6613F', size: 18 }),
        ],
      }),
    );
    if (block.prompt?.trim()) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          border: INSERTED_BORDER,
          children: [
            new TextRun({
              // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
              text: `지시: “${block.prompt.trim()}”`,
              italics: true,
              color: '8A8A8A',
              size: 18,
            }),
          ],
        }),
      );
    }
    children.push(...insertedSectionProse(block.md ?? '', citedIds));
    const src = sourceLine(citations, sources);
    if (src) children.push(src);
    return children;
  }

  // paragraph · insight (기본).
  const children: FileChild[] = proseParagraphs(block.md ?? '', citedIds);
  const src = sourceLine(citations, sources);
  if (src) children.push(src);
  return children;
}

/**
 * 탑라인 블록 배열 → Word(.docx) Buffer. 표지(제목 + 프로젝트명 + 생성일) 뒤에
 * 블록들을 스타일별로 렌더한다. 인용은 사람이 읽는 "근거: 문서명" 으로 변환하고
 * raw chunk_id 는 노출하지 않는다.
 */
export async function toplineBlocksToDocx(
  blocks: ToplineBlock[],
  opts: ToplineDocxOptions,
): Promise<Buffer> {
  const { projectName, generatedAt, sources } = opts;
  const dateStr = formatDate(generatedAt);
  // 문서 전체 출처 문서 — 표지 메타(응답 문서 수)와 말미 근거 인덱스가 공유.
  const allFilenames = collectAllFilenames(blocks, sources);
  const metaText =
    allFilenames.length > 0
      // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
      ? `근거 문서 ${allFilenames.length}건 · 생성일 ${dateStr}`
      // i18n-allow-korean -- docx 서버 렌더 라벨; 기존 문서 라벨(근거/생성일)과 동일 한국어 고정 패턴
      : `생성일 ${dateStr}`;

  // 표지 — 킥커 + 제목 + 메타(근거 문서 수·생성일) + 하단 구분선으로 리드를
  // 정돈한다(§C). 메타에 응답 문서 수를 담아 문서 규모를 한눈에 보이게.
  const children: FileChild[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 60 },
      children: [
        new TextRun({
          text: 'Research-Canvas 탑라인 보고서',
          bold: true,
          size: 20,
          color: '8A8A8A',
        }),
      ],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: projectName || '탑라인 보고서', bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: metaText, color: '8A8A8A', size: 20 })],
    }),
    new Paragraph({
      spacing: { after: 360 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E0DAD5', space: 8 } },
      children: [new TextRun('')],
    }),
  ];

  for (const block of blocks) {
    children.push(...blockToChildren(block, sources));
  }

  // 말미 "근거 문서" 인덱스 — 본문에서 접은 파일명을 한 번에 모아 추적성 유지(§A).
  children.push(...sourceIndexSection(allFilenames));

  const doc = new Document({
    styles: {
      default: {
        // desk-docx 와 동일한 per-script 폰트 폴백(Latin=Inter, CJK=Pretendard,
        // complex=Sarabun) — 한글이 깨지지 않게.
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
          reference: NUMBERING_REF,
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: 'left' },
          ],
        },
        {
          reference: SOURCE_NUMBERING_REF,
          levels: [
            { level: 0, format: 'decimal', text: '%1.', alignment: 'left' },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

// ISO(또는 null) → YYYY-MM-DD. 파싱 실패/미지정 시 오늘 날짜.
function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  const y = valid.getFullYear();
  const m = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
