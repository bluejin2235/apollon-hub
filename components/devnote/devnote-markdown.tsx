"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const t = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(t)) return t;
  return undefined;
}

export function DevnoteMarkdown({ content }: { content: string }) {
  const text = content.trimEnd();
  if (!text) return null;

  return (
    <div className="break-words text-[14px] leading-relaxed text-[#4A505C]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-8 text-[18px] font-bold tracking-tight text-[#15171C] first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-8 text-[16px] font-bold tracking-tight text-[#15171C] first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-3 mt-[34px] text-[15px] font-bold tracking-tight text-[#15171C] first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2.5 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2.5 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#15171C]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2.5 border-l-2 border-[#E2E5EA] pl-3 text-[#858C9A] last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-[#E2E5EA]" />,
          a: ({ href, children }) => {
            const safe = safeHref(href);
            if (!safe) return <span>{children}</span>;
            const className = "font-medium text-[#2B5BD7] underline underline-offset-2";
            if (safe.startsWith("/") || safe.startsWith("#")) {
              return (
                <Link href={safe} className={className}>
                  {children}
                </Link>
              );
            }
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
                {children}
              </a>
            );
          },
          code: ({ className, children }) => {
            const raw = String(children);
            const isBlock = Boolean(className) || raw.includes("\n");
            if (isBlock) {
              return <code className="font-mono text-[12.5px] text-inherit">{children}</code>;
            }
            return (
              <code className="rounded border border-[#EFF1F4] bg-[#F7F8FA] px-1 py-px font-mono text-[12.5px] text-[#15171C]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2.5 overflow-x-auto rounded-lg border border-[#EFF1F4] bg-[#F7F8FA] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-[#15171C] last:mb-0">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-2.5 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-[#E2E5EA]">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="w-[150px] py-1.5 pr-4 text-left font-medium text-[#858C9A] align-top">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[#EFF1F4] py-1.5 text-[#15171C]">{children}</td>
          ),
          input: ({ type, checked }) => {
            if (type !== "checkbox") return null;
            return (
              <input
                type="checkbox"
                checked={Boolean(checked)}
                readOnly
                className="mr-2 align-middle accent-[#2B5BD7]"
              />
            );
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
