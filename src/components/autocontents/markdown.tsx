"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words text-md leading-7 text-ink-2 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...p }) => (
            <h1 className="mb-2 mt-4 text-xl font-semibold first:mt-0" {...p} />
          ),
          h2: ({ ...p }) => (
            <h2
              className="mb-2 mt-4 text-lg font-semibold first:mt-0"
              {...p}
            />
          ),
          h3: ({ ...p }) => (
            <h3
              className="mb-1.5 mt-3 text-md font-semibold first:mt-0"
              {...p}
            />
          ),
          h4: ({ ...p }) => (
            <h4
              className="mb-1 mt-2 text-md font-semibold first:mt-0"
              {...p}
            />
          ),
          p: ({ ...p }) => <p className="my-2 leading-7" {...p} />,
          ul: ({ ...p }) => (
            <ul className="my-2 list-disc space-y-1 pl-5" {...p} />
          ),
          ol: ({ ...p }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />
          ),
          li: ({ ...p }) => <li className="leading-7" {...p} />,
          strong: ({ ...p }) => <strong className="font-semibold" {...p} />,
          em: ({ ...p }) => <em className="italic" {...p} />,
          a: ({ ...p }) => (
            <a
              className="text-amore underline underline-offset-2 hover:text-amore-soft"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          code: ({ ...p }) => (
            <code
              className="rounded-xs bg-paper-soft px-1 py-0.5 text-sm"
              {...p}
            />
          ),
          pre: ({ ...p }) => (
            <pre
              className="my-2 overflow-x-auto rounded-xs bg-paper-soft p-3 text-sm"
              {...p}
            />
          ),
          blockquote: ({ ...p }) => (
            <blockquote
              className="my-2 border-l-2 border-line pl-3 text-mute"
              {...p}
            />
          ),
          hr: () => (
            <hr className="my-3 border-line" />
          ),
          table: ({ ...p }) => (
            <div className="my-2 overflow-x-auto">
              <table
                className="w-full border-collapse text-md"
                {...p}
              />
            </div>
          ),
          th: ({ ...p }) => (
            <th
              className="border border-line bg-paper-soft px-2 py-1 text-left font-semibold"
              {...p}
            />
          ),
          td: ({ ...p }) => (
            <td
              className="border border-line px-2 py-1"
              {...p}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
