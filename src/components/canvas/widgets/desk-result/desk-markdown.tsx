'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 데스크 결과 보고서 markdown 렌더러 — desk-card-body 와 widget grid
// (desk-report-view) 가 공유한다. 이전엔 desk-card-body 안에 inline 으로
// 있었으나, 위젯 카드들이 같은 톤으로 본문을 렌더해야 해서 추출.
//
// `compact` = 카드 안에 들어가는 작은 본문 (Findings 토픽 / RQ 답변 등).
// 기본은 모달 본문용 큰 톤. 색·간격은 모두 design-system 토큰만 사용.

const FULL_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 mt-2 border-b border-line pb-2 text-3xl font-bold tracking-[-0.02em] text-ink first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-8 text-2xl font-bold tracking-[-0.018em] text-ink-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-xl font-semibold tracking-[-0.005em] text-ink-2">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="my-2.5 text-lg leading-[1.8] text-ink-2">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-ink-2">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-amore bg-white px-4 py-2 text-lg italic text-ink-2">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="border border-line bg-white px-1.5 py-0.5 font-mono text-md text-ink-2 [border-radius:3px]">
      {children}
    </code>
  ),
  hr: () => <hr className="my-6 border-line-soft" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-ink">{children}</strong>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xs border border-line">
      <table className="w-full border-collapse text-md">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-white text-xs uppercase tracking-[.16em] text-mute-soft">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="border-b border-line px-3 py-2 text-left font-medium text-mute">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-line-soft px-3 py-2 align-top text-ink-2">
      {children}
    </td>
  ),
};

// 카드 안에 들어가는 컴팩트 톤 — 폰트/간격을 한 단계 줄이고 헤딩은
// 카드 헤더가 대신하므로 작게.
const COMPACT_COMPONENTS: Components = {
  ...FULL_COMPONENTS,
  h1: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-md font-semibold text-ink-2 first:mt-0">
      {children}
    </h4>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-md font-semibold text-ink-2 first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mb-1 mt-2.5 text-sm font-semibold text-ink-2 first:mt-0">
      {children}
    </h5>
  ),
  p: ({ children }) => (
    <p className="my-1.5 text-sm leading-[1.7] text-ink-2">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-4 text-sm leading-[1.7] marker:text-mute-soft">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-4 text-sm leading-[1.7] marker:text-mute-soft">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-ink-2">{children}</li>,
};

export function DeskMarkdownBody({
  source,
  compact = false,
}: {
  source: string;
  compact?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={compact ? COMPACT_COMPONENTS : FULL_COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
}
