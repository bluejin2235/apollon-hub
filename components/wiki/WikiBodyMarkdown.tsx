"use client";

import type { ReactNode } from "react";
import { HighlightPhrase } from "@/components/glossary/HighlightPhrase";
import { isSourceBlock } from "@/lib/glossary/highlight";
import {
  parseWikiBodyMarkdown,
  parseWikiInline,
  type WikiInlinePart,
  type WikiMdBlock
} from "@/lib/wiki/body-markdown";
import "@/components/wiki/wiki-body.css";

function safeWikiHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return null;
}

function WikiInlineParts({
  parts,
  highlightTerms
}: {
  parts: WikiInlinePart[];
  highlightTerms?: boolean;
}) {
  return (
    <>
      {parts.map((part, i) => (
        <WikiInlinePartNode key={i} part={part} highlightTerms={highlightTerms} />
      ))}
    </>
  );
}

function WikiInline({
  text,
  highlightTerms
}: {
  text: string;
  highlightTerms?: boolean;
}) {
  const parts = parseWikiInline(text);
  return <WikiInlineParts parts={parts} highlightTerms={highlightTerms} />;
}

function WikiInlinePartNode({
  part,
  highlightTerms
}: {
  part: WikiInlinePart;
  highlightTerms?: boolean;
}) {
  if (part.type === "bold") {
    return (
      <strong className="wiki-body-strong" style={{ fontWeight: 700 }}>
        <WikiInlineParts parts={part.children} highlightTerms={highlightTerms} />
      </strong>
    );
  }
  if (part.type === "italic") {
    return (
      <em className="wiki-body-em">
        <WikiInlineParts parts={part.children} highlightTerms={highlightTerms} />
      </em>
    );
  }
  if (part.type === "code") {
    return <code className="wiki-body-code">{part.value}</code>;
  }
  if (part.type === "link") {
    const href = safeWikiHref(part.href);
    if (!href) {
      return <>{part.text}</>;
    }
    return (
      <a href={href} className="wiki-body-link" target="_blank" rel="noopener noreferrer">
        <WikiInline text={part.text} highlightTerms={highlightTerms} />
      </a>
    );
  }
  if (part.type === "color") {
    return (
      <span className="wiki-body-color" style={{ color: part.color }}>
        <WikiInlineParts parts={part.children} highlightTerms={highlightTerms} />
      </span>
    );
  }
  if (part.type !== "text") {
    return null;
  }
  if (!highlightTerms || isSourceBlock(part.value)) {
    return <>{part.value}</>;
  }
  return <HighlightPhrase>{part.value}</HighlightPhrase>;
}

function WikiMdBlockView({
  block,
  highlightTerms
}: {
  block: WikiMdBlock;
  highlightTerms?: boolean;
}) {
  switch (block.type) {
    case "heading":
      return (
        <h2 className="wiki-body-h2">
          <WikiInline text={block.text} highlightTerms={highlightTerms} />
        </h2>
      );
    case "paragraph":
      return (
        <p className="wiki-body-p">
          {block.lines.map((line, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              <WikiInline text={line} highlightTerms={highlightTerms} />
            </span>
          ))}
        </p>
      );
    case "ul":
      return (
        <ul className="wiki-body-ul">
          {block.items.map((item, i) => (
            <li key={i}>
              <WikiInline text={item} highlightTerms={highlightTerms} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="wiki-body-ol">
          {block.items.map((item, i) => (
            <li key={i}>
              <WikiInline text={item} highlightTerms={highlightTerms} />
            </li>
          ))}
        </ol>
      );
    case "hr":
      return <hr className="wiki-body-hr" />;
    case "table":
      return (
        <div className="wiki-body-table-wrap">
          <table className="wiki-body-table">
            {block.headers.length > 0 ? (
              <thead>
                <tr>
                  {block.headers.map((cell, i) => (
                    <th key={i}>
                      <WikiInline text={cell} highlightTerms={highlightTerms} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <WikiInline text={cell} highlightTerms={highlightTerms} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export function WikiBodyMarkdown({
  text,
  highlightTerms = false,
  className = ""
}: {
  text: string;
  highlightTerms?: boolean;
  className?: string;
}) {
  const blocks = parseWikiBodyMarkdown(text);
  if (blocks.length === 0) return null;

  const body: ReactNode = blocks.map((block, i) => (
    <WikiMdBlockView key={i} block={block} highlightTerms={highlightTerms} />
  ));

  return <div className={`wiki-body ${className}`.trim()}>{body}</div>;
}
