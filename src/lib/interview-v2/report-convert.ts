// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) 파일 → Markdown 정규화.
//
// #594 는 Markdown 직업로드만 받았다. #595 는 DOCX/PDF/HTML 등 비-Markdown 포맷을
// 수용하기 위해, 업로드 파일을 **구조 보존** Markdown 으로 먼저 정규화한 뒤
// parseMarkdownToToplineBlocks 에 넘긴다.
//
// spec §C(원문 보존, LLM 재작성 금지) — 이 변환은 순수 구조 추출만 한다. 인터뷰
// 전사 정리용 `convertFileToMarkdown`(insights/convert.ts)은 재사용하지 않는다:
// 그쪽은 화자 라벨 인터뷰를 `## Q.` 노트로 **재작성**하는 LLM 경로라, 완성된
// 외부 보고서에는 부적합하기 때문(원문 훼손). 대신 같은 추출 인프라(file-extract)
// 를 재사용하되 LLM 정리 단계를 건너뛰고, DOCX/HTML 은 구조 보존 HTML→Markdown
// (mammoth.convertToHtml + turndown-gfm)으로 헤딩·표·리스트·인용을 살린다.
//
// 포맷별:
//   - text/markdown(.md/.txt 등) → 원문 그대로(이미 Markdown, 재작성 없음)
//   - HTML(.html/.htm)           → turndown(gfm) 으로 Markdown(표=GFM 파이프)
//   - DOCX                       → mammoth HTML → turndown(gfm) Markdown
//   - PDF                        → 텍스트만 추출(신뢰할 구조 없음, best-effort)
//   - audio/video/xlsx/그 외     → unsupported(보고서 업로드 대상 아님)

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { classifyFile, extractDocText } from '@/lib/file-extract';

export type ReportFormat = 'text' | 'html' | 'docx' | 'pdf';

export type ReportConvertResult = {
  markdown: string;
  format: ReportFormat;
};

const HTML_RE = /\.(html?|xhtml)$/i;

/** classifyFile 은 text/html 을 'text'로 보므로 HTML 은 여기서 먼저 판정. */
function isHtml(file: File): boolean {
  return (
    file.type === 'text/html' ||
    file.type === 'application/xhtml+xml' ||
    HTML_RE.test(file.name)
  );
}

/** GFM 표/취소선을 파이프 Markdown 으로 뽑는 turndown 인스턴스. */
function newTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx', // `#` 헤딩 — 파서가 섹션 경계로 인식.
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    hr: '---',
  });
  td.use(gfm); // 표 → `| a | b |` + `---` (parseMarkdownToToplineBlocks 가 table 블록으로).
  return td;
}

/**
 * 업로드 파일을 구조 보존 Markdown 으로 정규화한다. LLM 재작성 없음 — 순수
 * 추출/변환. 지원 밖 포맷은 throw(라우트가 415 로 응답).
 */
export async function convertReportFileToMarkdown(
  file: File,
): Promise<ReportConvertResult> {
  if (isHtml(file)) {
    const html = await file.text();
    return { markdown: newTurndown().turndown(html), format: 'html' };
  }

  const kind = classifyFile(file);
  if (kind === 'text') {
    // 이미 Markdown/평문 — 원문 그대로(구조·표기 손실 0).
    return { markdown: await file.text(), format: 'text' };
  }
  if (kind === 'docx') {
    const buf = Buffer.from(await file.arrayBuffer());
    // extractRawText 는 헤딩/표를 평문으로 뭉갠다. convertToHtml 은 Word 스타일을
    // 시맨틱 HTML(h1/table/ul/blockquote)로 보존 → turndown 으로 구조 살린 Markdown.
    const { value: html } = await mammoth.convertToHtml({ buffer: buf });
    return { markdown: newTurndown().turndown(html), format: 'docx' };
  }
  if (kind === 'pdf') {
    // PDF 는 신뢰할 시맨틱 구조가 없어 텍스트만 추출(문단 보존, best-effort).
    const text = await extractDocText(file);
    return { markdown: text, format: 'pdf' };
  }
  throw new Error(`unsupported_report_type: ${file.type || file.name}`);
}
