// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) Markdown → blocks 파서.
//
// 사용자가 외부(Claude/NotebookLM 등)에서 완성한 보고서를 Markdown 으로 업로드하면
// 이 순수 함수가 그 md 를 탑라인 blocks 구조로 매핑한다. 두 모드(생성/업로드)의
// 최종 산출물이 **동일한 blocks 구조**라, 파싱 후에는 기존 편집 도구(edit_block,
// 섹션 삽입, drag-to-ask)가 그대로 동작한다(사용자 핵심 요구).
//
// 이 PR 의 범위 = Markdown 기본 매핑(과설계 금지 — spec §D). DOCX/PDF/HTML 확장과
// 표/차트 인식 정교화는 후속(#595). 표·리스트는 paragraph md 안에 markdown 원문
// 으로 보존하며(ToplineBlockView 의 Prose 가 remark-gfm 으로 렌더), 별도 table/
// chart 블록으로 구조화하지 않는다.
//
// 매핑 규칙 (보수적):
//   - `#` 헤딩            → heading  (최상위 섹션 경계, 렌더 = h2)
//   - `##`+ 헤딩          → subheading(하위 섹션, 렌더 = h3)
//   - 빈 줄로 구분된 문단  → paragraph(리스트/표 markdown 은 그 안에 원문 보존)
//   - **첫 헤딩 이전** 최상단 프로즈 → executive_summary(휴리스틱; 없으면 전부 paragraph)
//
// 서버가 blk_NN 안정 id 를 부여(생성 파이프라인 verifyBlockCitations 와 동일 스킴)
// 해 drag-to-ask/편집의 data-block-id 계약을 만족한다. 업로드 보고서는 인터뷰
// 근거 chunk 매핑이 없으므로 citations 는 항상 빈 배열이다.

import type { ToplineBlock } from '@/lib/interview-v2/types';

// 파싱된 블록 하나가 감당할 수 있는 최대 md 길이 가드는 라우트(zod)가 전체 입력
// 길이로 담당한다 — 여기선 구조 매핑만.

/** 헤딩 라인 매칭 — `#`~`######` + 공백 + 텍스트. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

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

  // (id 없는) 중간 표현으로 먼저 모으고, 마지막에 blk_NN 을 부여한다.
  type Draft =
    | { type: 'executive_summary'; summary: string }
    | { type: 'heading'; md: string }
    | { type: 'subheading'; md: string }
    | { type: 'paragraph'; md: string };
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

  for (const line of lines) {
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
    return { id, type: 'paragraph', md: d.md, citations: [] };
  });
}
