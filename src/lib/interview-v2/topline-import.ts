// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) Markdown → blocks 파서.
//
// 사용자가 외부(Claude/NotebookLM 등)에서 완성한 보고서를 업로드하면 이 순수
// 함수가 그 md 를 탑라인 blocks 구조로 매핑한다. 두 모드(생성/업로드)의 최종
// 산출물이 **동일한 blocks 구조**라, 파싱 후에는 기존 편집 도구(edit_block,
// 섹션 삽입, drag-to-ask)가 그대로 동작한다(사용자 핵심 요구).
//
// #595 정교화 범위 = 구조 인식 강화(원문 보존, LLM 재작성 없음 — spec §C):
//   - 헤딩 계층(`#`/`##`+)             → heading / subheading (섹션 경계·레벨)
//   - **GFM 표**(`| a | b |` + `---`)  → table 블록({headers, rows}) — 렌더가
//                                        구조화 표로 그림(topline-blocks table)
//   - **인용/출처**(`> …` blockquote,   → quote 블록(md + attribution). 말미
//     말미 "— 출처" 표기)                "— X" 는 attribution 으로 분리
//   - 빈 줄로 구분된 문단               → paragraph(리스트 md 는 그 안에 원문
//                                        보존, ToplineBlockView 의 Prose 가
//                                        remark-gfm 으로 불릿 렌더)
//   - **첫 헤딩 이전** 최상단 프로즈    → executive_summary(휴리스틱; 없으면 전부
//                                        paragraph)
//
// 인식 실패분은 전부 paragraph 로 안전하게 흘려보내 **데이터 손실 0** 을 우선한다
// (표/인용으로 확정되지 않으면 그냥 문단). 차트 자동 생성은 범위 밖(spec §C).
//
// DOCX/PDF/HTML 등 비-Markdown 포맷은 라우트가 report-convert 로 먼저 markdown
// 정규화(구조 보존)한 뒤 이 파서에 넘긴다 — 이 함수는 어디서 온 md 든 동일하게
// 구조 매핑만 한다.
//
// 서버가 blk_NN 안정 id 를 부여(생성 파이프라인 verifyBlockCitations 와 동일 스킴)
// 해 drag-to-ask/편집의 data-block-id 계약을 만족한다. 업로드 보고서는 인터뷰
// 근거 chunk 매핑이 없으므로 citations 는 항상 빈 배열이다.

import type { ToplineBlock } from '@/lib/interview-v2/types';

/** 헤딩 라인 매칭 — `#`~`######` + 공백 + 텍스트. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** blockquote 라인 — 선행 `>` + 선택 공백 + 본문. */
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;

/** 인용 말미 출처 표기 — em/en 대시 또는 `--` 로 시작하는 한 줄("— 파일명"). */
const ATTRIBUTION_RE = /^\s*(?:—|–|--)\s*(.+?)\s*$/;

/** GFM 표 셀 분리 — 좌우 파이프 제거 후 이스케이프 안 된 `|` 로 분할. */
function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** GFM 표 구분선(`| --- | :--: |`)인지 — 모든 셀이 `:?-+:?` 이고 `-` 하나 이상. */
function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

/** 표 후보 행 — 파이프를 포함한 비어있지 않은 라인. */
function looksLikeTableRow(line: string): boolean {
  return line.includes('|') && /\S/.test(line);
}

/**
 * 업로드 Markdown 을 탑라인 blocks 로 파싱한다. 순수 함수(DB/네트워크 무관) —
 * 라우트가 소유 검증 후 이 결과를 blocks jsonb 로 영속한다. 블록이 하나도 안 나오면
 * 빈 배열(라우트가 empty 로 거부).
 *
 * id 는 blk_NN(1-based, 2자리 zero-pad; 100+ 은 자연 확장)으로 부여해 편집/삽입의
 * anchor 계약을 만족한다.
 */
export function parseMarkdownToToplineBlocks(md: string): ToplineBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const n = lines.length;

  // (id 없는) 중간 표현으로 먼저 모으고, 마지막에 blk_NN 을 부여한다.
  type Draft =
    | { type: 'executive_summary'; summary: string }
    | { type: 'heading'; md: string }
    | { type: 'subheading'; md: string }
    | { type: 'paragraph'; md: string }
    | { type: 'table'; headers: string[]; rows: string[][] }
    | { type: 'quote'; md: string; attribution?: string };
  const drafts: Draft[] = [];

  let paraLines: string[] = [];
  let seenHeading = false;
  // 최상단(첫 헤딩 이전) 프로즈를 executive_summary 로 승격하는 건 딱 한 번만.
  let execUsed = false;

  const flushParagraph = () => {
    const text = paraLines.join('\n').trim();
    paraLines = [];
    if (!text) return;
    // 휴리스틱: 문서 첫 헤딩이 나오기 전의 최상단 프로즈 첫 덩어리 = 요약 리드로
    // 간주해 executive_summary 로. 이후(또는 헤딩 뒤) 프로즈는 전부 paragraph.
    if (!seenHeading && !execUsed) {
      execUsed = true;
      drafts.push({ type: 'executive_summary', summary: text });
      return;
    }
    drafts.push({ type: 'paragraph', md: text });
  };

  for (let i = 0; i < n; i++) {
    const line = lines[i];

    const heading = HEADING_RE.exec(line);
    if (heading) {
      // 헤딩은 진행 중 문단을 끊고 자기 블록이 된다.
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].trim();
      if (!text) continue; // `#` 만 있고 텍스트 없음 — 건너뜀.
      seenHeading = true;
      drafts.push(
        level === 1
          ? { type: 'heading', md: text }
          : { type: 'subheading', md: text },
      );
      continue;
    }

    // GFM 표 — 헤더 행 + 바로 다음 구분선이 짝을 이룰 때만 구조화. 셀이 전부
    // 비면(구분선 오탐 등) 표로 안 보고 문단으로 흘린다(손실 0).
    if (
      looksLikeTableRow(line) &&
      i + 1 < n &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      if (headers.some((h) => h.length > 0)) {
        flushParagraph();
        const rows: string[][] = [];
        let j = i + 2;
        for (; j < n; j++) {
          const rowLine = lines[j];
          if (!looksLikeTableRow(rowLine)) break;
          const cells = splitTableRow(rowLine);
          // 헤더 열 수에 맞춰 정규화(부족분 빈칸, 초과분 절삭) — 렌더 안정.
          const norm = headers.map((_, c) => cells[c] ?? '');
          rows.push(norm);
        }
        drafts.push({ type: 'table', headers, rows });
        i = j - 1; // 마지막으로 소비한 행에 커서 정렬(루프 ++로 다음 라인).
        continue;
      }
      // else: 표로 확정 못 함 → 아래 문단 경로로 떨어진다.
    }

    // Blockquote 인용 — 연속된 `>` 라인 묶음 → quote 블록. 말미 "— 출처" 는
    // attribution 으로 분리(citation 메타 정합), 본문은 md 로 보존.
    if (BLOCKQUOTE_RE.test(line)) {
      flushParagraph();
      const inner: string[] = [];
      let j = i;
      for (; j < n; j++) {
        const m = BLOCKQUOTE_RE.exec(lines[j]);
        if (!m) break;
        inner.push(m[1]);
      }
      i = j - 1;
      // 말미 비어있지 않은 라인이 대시 출처면 attribution 으로 뗀다.
      let attribution: string | undefined;
      let lastIdx = inner.length - 1;
      while (lastIdx >= 0 && inner[lastIdx].trim() === '') lastIdx--;
      if (lastIdx >= 0) {
        const attr = ATTRIBUTION_RE.exec(inner[lastIdx]);
        if (attr) {
          attribution = attr[1].trim();
          inner.splice(lastIdx, 1);
        }
      }
      const quoteMd = inner.join('\n').trim();
      if (quoteMd || attribution) {
        drafts.push({ type: 'quote', md: quoteMd, attribution });
      }
      continue;
    }

    if (line.trim() === '') {
      // 빈 줄 = 문단 경계.
      flushParagraph();
      continue;
    }
    paraLines.push(line);
  }
  flushParagraph();

  return drafts.map((d, i) => {
    const id = `blk_${String(i + 1).padStart(2, '0')}`;
    if (d.type === 'executive_summary') {
      return {
        id,
        type: 'executive_summary',
        summary: d.summary,
        key_points: [],
        citations: [],
      };
    }
    if (d.type === 'heading' || d.type === 'subheading') {
      return { id, type: d.type, md: d.md };
    }
    if (d.type === 'table') {
      return {
        id,
        type: 'table',
        table: { headers: d.headers, rows: d.rows },
      };
    }
    if (d.type === 'quote') {
      return {
        id,
        type: 'quote',
        md: d.md,
        attribution: d.attribution,
        citations: [],
      };
    }
    return { id, type: 'paragraph', md: d.md, citations: [] };
  });
}
