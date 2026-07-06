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
  type FileChild,
} from 'docx';
import { parseInline, inlineToRuns, buildTable } from '@/lib/desk-docx';
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

// "근거: 파일1, 파일2" — 블록 끝 출처 표기(작은 회색 이탤릭). 출처가 없으면 null.
function sourceLine(
  citations: string[] | undefined,
  sources: Map<string, CitationSource>,
): Paragraph | null {
  const names = citedFilenames(citations, sources);
  if (names.length === 0) return null;
  return new Paragraph({
    spacing: { before: 40, after: 160 },
    children: [
      new TextRun({
        text: `근거: ${names.join(', ')}`,
        italics: true,
        color: '8A8A8A',
        size: 18,
      }),
    ],
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

  if (block.type === 'heading') {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: block.md ?? '', bold: true })],
      }),
    ];
  }

  if (block.type === 'subheading') {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 80 },
        children: [new TextRun({ text: block.md ?? '', bold: true })],
      }),
    ];
  }

  if (block.type === 'chart' || block.type === 'pie') {
    // 차트 이미지 렌더는 export 워커 후속(#425 인계 노트) — 여기선 제목 + 데이터
    // 항목을 불릿으로 텍스트화해 문서에 값이 남게 한다(blank 방지).
    const children: FileChild[] = [];
    if (block.title) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: block.title, bold: true })],
        }),
      );
    }
    if (block.description) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: block.description, color: '8A8A8A', size: 20 }),
          ],
        }),
      );
    }
    for (const d of block.data ?? []) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: `${d.label}: ${d.value}` })],
        }),
      );
    }
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
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: block.md, bold: true })],
        }),
      );
    }
    // 셀 안의 inline 인용 토큰도 제거해 raw chunk_id 노출을 막는다.
    const strip = (s: string) => stripInlineCitations(s, citedIds);
    children.push(
      buildTable(
        block.table.headers.map(strip),
        block.table.rows.map((row) => row.map(strip)),
      ),
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
      spacing: { after: 360 },
      children: [
        new TextRun({ text: `생성일 ${dateStr}`, color: '8A8A8A', size: 20 }),
      ],
    }),
  ];

  for (const block of blocks) {
    children.push(...blockToChildren(block, sources));
  }

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
