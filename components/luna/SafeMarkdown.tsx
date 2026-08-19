"use client";

import Link from "next/link";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightPhrase, HighlightScope, flattenPlain, useHighlightUsed } from "@/components/glossary/HighlightPhrase";
import { isSourceBlock, prepareMarkdownEmphasis } from "@/lib/glossary/highlight";
import type { ReactNode } from "react";

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const t = href.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(t)) return t;
  return undefined;
}

function wrap(highlight: boolean, children: ReactNode) {
  if (!highlight) return children;
  if (isSourceBlock(flattenPlain(children))) return children;
  return <HighlightPhrase>{children}</HighlightPhrase>;
}

function makeComponents(
  compact?: boolean,
  variant?: "default" | "luna",
  highlight?: boolean
): Components {
  const on = highlight === true;
  const pGap = compact ? "mb-1.5" : variant === "luna" ? "mb-4" : "mb-2";
  const isLuna = variant === "luna";
  const inlineCodeClass = isLuna
    ? "rounded border border-[#E3E0F5] bg-white px-[5px] py-px font-mono text-[12px] text-[#1c1d21]"
    : "rounded bg-slate-200/80 px-1 py-px text-[12px] text-slate-800";
  const preClass = isLuna
    ? "my-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-[#E3E0F5] bg-white px-[11px] py-[9px] font-mono text-[12px] leading-[1.7] text-[#1c1d21] last:mb-0"
    : "my-2 overflow-x-auto rounded-lg bg-slate-800 px-3 py-2 text-[12px] leading-relaxed text-slate-100 last:mb-0";

  const MdP = ({ children }: { children?: ReactNode }) => (
    <p className={`${pGap} last:mb-0 whitespace-pre-wrap`}>{wrap(on, children)}</p>
  );
  MdP.displayName = "MdP";
  const MdLi = ({ children }: { children?: ReactNode }) => (
    <li className="leading-[1.55]">{wrap(on, children)}</li>
  );
  MdLi.displayName = "MdLi";
  const MdStrong = ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  );
  MdStrong.displayName = "MdStrong";
  const MdA = ({ href, children }: { href?: string; children?: ReactNode }) => {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    const className = "font-medium text-[#534AB7] underline underline-offset-2";
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
  };
  MdA.displayName = "MdA";
  const MdCode = ({ className, children }: { className?: string; children?: ReactNode }) => {
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
  };
  MdCode.displayName = "MdCode";
  const MdPre = ({ children }: { children?: ReactNode }) => (
    <pre className={preClass}>{children}</pre>
  );
  MdPre.displayName = "MdPre";
  const MdH1 = ({ children }: { children?: ReactNode }) => (
    <h1 className={`${pGap} text-[15px] font-semibold last:mb-0`}>
      {wrap(on, children)}
    </h1>
  );
  MdH1.displayName = "MdH1";
  const MdH2 = ({ children }: { children?: ReactNode }) => (
    <h2 className={`${pGap} text-[14px] font-semibold last:mb-0`}>
      {wrap(on, children)}
    </h2>
  );
  MdH2.displayName = "MdH2";
  const MdH3 = ({ children }: { children?: ReactNode }) => (
    <h3 className={`${pGap} text-[13px] font-semibold last:mb-0`}>
      {wrap(on, children)}
    </h3>
  );
  MdH3.displayName = "MdH3";
  const MdTd = ({ children }: { children?: ReactNode }) => (
    <td className="border-t border-slate-100 px-2 py-1.5">{wrap(on, children)}</td>
  );
  MdTd.displayName = "MdTd";
  const MdTh = ({ children }: { children?: ReactNode }) => (
    <th className="px-2 py-1.5 text-left font-semibold">{wrap(on, children)}</th>
  );
  MdTh.displayName = "MdTh";

  return {
    p: MdP,
    strong: MdStrong,
    em: ({ children }) => <em className="italic">{wrap(on, children)}</em>,
    ul: ({ children }) => (
      <ul className={`${pGap} list-disc space-y-0.5 pl-5 last:mb-0`}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className={`${pGap} list-decimal space-y-0.5 pl-5 last:mb-0`}>{children}</ol>
    ),
    li: MdLi,
    blockquote: ({ children }) => (
      <blockquote
        className={`${pGap} border-l-2 border-slate-300 pl-3 text-slate-600 last:mb-0`}
      >
        {wrap(on, children)}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-slate-200" />,
    a: MdA,
    img: ({ alt }) => (
      <span className="text-slate-500">[{alt?.trim() || "image"}]</span>
    ),
    pre: MdPre,
    code: MdCode,
    h1: MdH1,
    h2: MdH2,
    h3: MdH3,
    table: ({ children }) => (
      <div className={`${pGap} overflow-x-auto last:mb-0`}>
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-slate-200">{children}</thead>
    ),
    th: MdTh,
    td: MdTd
  };
}

type SafeMarkdownProps = {
  content: string;
  className?: string;
  compact?: boolean;
  variant?: "default" | "luna";
  highlightTerms?: boolean;
};

/**
 * 루나·위키 본문용 마크다운. raw HTML 비허용(react-markdown 기본).
 * highlightTerms: 용어사전 점선 밑줄. strong/a/code 안은 건너뛴다.
 */
export function SafeMarkdown({
  content,
  className = "",
  compact,
  variant = "default",
  highlightTerms = false
}: SafeMarkdownProps) {
  const text = prepareMarkdownEmphasis(content.trimEnd());
  if (!text) return null;
  const markdown = (
    <div className={`break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={makeComponents(compact, variant, highlightTerms)}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
  if (!highlightTerms) return markdown;
  return (
    <SafeMarkdownHighlightRoot resetKey={text}>{markdown}</SafeMarkdownHighlightRoot>
  );
}

function SafeMarkdownHighlightRoot({
  resetKey,
  children
}: {
  resetKey: string;
  children: ReactNode;
}) {
  const outer = useHighlightUsed();
  if (outer) return <>{children}</>;
  return <HighlightScope resetKey={resetKey}>{children}</HighlightScope>;
}
