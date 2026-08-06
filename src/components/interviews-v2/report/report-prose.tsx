'use client';

/* ────────────────────────────────────────────────────────────────────
   ReportProse — 읽기 모드 보고서 프로즈 렌더 (fresh · 블록 §1.3 para/insight/
   inserted 계열 공용). react-markdown + remark-gfm 로 md 를 렌더하되:

   - inline `[chunk_id]` 원문 토큰은 렌더 전에 strip 한다(프롬프트가 md 에 넣는
     형식이 사람이 읽을 형식이 아님 — 기존 stripCiteTokens 규칙 미러, BUILD-SPEC
     §0.3). 블록의 citations[] 는 문장 끝 위첨자 칩으로 따로 렌더(§1.4).
   - 문단은 unwrap 해 흐르는 텍스트로 렌더한다(한 블록 = 한 문단 계약이라 안전).
     캘러는 블록별 타이포/색 클래스를 wrapper 로 준다. 볼드는 ink 800.

   기존 topline-blocks.tsx(superseded)의 렌더 로직을 복붙하지 않되, 같은 라이브러리
   (react-markdown/remark-gfm)와 같은 strip 규칙을 재사용해 결과 정합을 지킨다.
   ──────────────────────────────────────────────────────────────────── */

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CitationChips } from './citation';

// inline [chunk_id] 토큰 제거 — citations 에 있는 id 만 지운다(일반 대괄호 보존).
// docx stripInlineCitations · topline-blocks stripCiteTokens 와 동일 규칙.
function stripCiteTokens(md: string, cited: Set<string>): string {
  if (cited.size === 0) return md;
  return md
    .replace(/\s*\[([^\]\n]+)\](?!\()/g, (full, tok: string) =>
      cited.has(tok.trim()) ? '' : full,
    )
    .replace(/[ \t]+([.,;:?!、。])/g, '$1');
}

// 흐르는 인라인 프로즈용 컴포넌트 — 문단 unwrap(볼드/링크만 inline). 링크는
// amore-deep, 볼드는 ink 800.
const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => (
    <strong className="font-extrabold text-ink">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-amore-deep underline decoration-amore-deep/40 underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-mute-soft">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-mute-soft">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-[1.8]">{children}</li>,
};

// md 프로즈 + 문장 끝 근거 칩. wrapper(타이포/색)는 caller 소유 — 여기서는
// 인라인 콘텐츠만 반환한다. citations 가 비면 칩은 아무것도 렌더하지 않는다.
export function ReportProse({
  md,
  citations,
}: {
  md?: string;
  citations?: string[];
}) {
  const cited = new Set((citations ?? []).map((c) => c.trim()));
  const clean = stripCiteTokens(md ?? '', cited).trim();
  return (
    <>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={INLINE_COMPONENTS}>
        {clean}
      </ReactMarkdown>
      <CitationChips citations={citations} />
    </>
  );
}
