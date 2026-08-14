"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const t = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(t)) return t;
  return undefined;
}

function makeComponents(compact?: boolean, variant?: "default" | "luna"): Components {
  const pGap = compact ? "mb-1.5" : variant === "luna" ? "mb-4" : "mb-2";
  const isLuna = variant === "luna";
  const inlineCodeClass = isLuna
    ? "rounded border border-[#E3E0F5] bg-white px-[5px] py-px font-mono text-[12px] text-[#1c1d21]"
    : "rounded bg-slate-200/80 px-1 py-px text-[12px] text-slate-800";
  const preClass = isLuna
    ? "my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[#E3E0F5] bg-white px-[11px] py-[9px] font-mono text-[12px] leading-[1.7] text-[#1c1d21] last:mb-0"
    : "my-2 overflow-x-auto rounded-lg bg-slate-800 px-3 py-2 text-[12px] leading-relaxed text-slate-100 last:mb-0";
  return {
    p: ({ children }) => (
      <p className={`${pGap} last:mb-0 whitespace-pre-wrap`}>{children}</p>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => (
      <ul className={`${pGap} list-disc space-y-0.5 pl-5 last:mb-0`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={`${pGap} list-decimal space-y-0.5 pl-5 last:mb-0`}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-[1.55]">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        className={`${pGap} border-l-2 border-slate-300 pl-3 text-slate-600 last:mb-0`}
      >
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-slate-200" />,
    a: ({ href, children }) => {
      const safe = safeHref(href);
      if (!safe) {
        return <span>{children}</span>;
      }
      return (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[#534AB7] underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    // raw HTML / images 미지원 — XSS·트래킹 방지
    img: ({ alt }) => (
      <span className="text-slate-500">[{alt?.trim() || "image"}]</span>
    ),
    pre: ({ children }) => <pre className={preClass}>{children}</pre>,
    code: ({ className, children }) => {
      const raw = String(children);
      const isBlock = Boolean(className) || raw.includes("\n");
      if (isBlock) {
        return (
          <code className={`font-mono text-[12px] text-inherit ${className ?? ""}`}>
            {children}
          </code>
        );
      }
      return <code className={inlineCodeClass}>{children}</code>;
    },
    h1: ({ children }) => (
      <h1 className={`${pGap} text-[15px] font-semibold last:mb-0`}>
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className={`${pGap} text-[14px] font-semibold last:mb-0`}>
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className={`${pGap} text-[13px] font-semibold last:mb-0`}>
        {children}
      </h3>
    )
  };
}

type SafeMarkdownProps = {
  content: string;
  className?: string;
  compact?: boolean;
  variant?: "default" | "luna";
};

/**
 * 루나 답변용 마크다운. raw HTML 비허용(react-markdown 기본).
 * [[가정:]] / 번호 선택지 파싱은 호출 전에 끝낸 본문만 넘긴다.
 */
export function SafeMarkdown({
  content,
  className = "",
  compact,
  variant = "default"
}: SafeMarkdownProps) {
  const text = content.trimEnd();
  if (!text) return null;
  return (
    <div className={`break-words ${className}`}>
      <ReactMarkdown components={makeComponents(compact, variant)} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
