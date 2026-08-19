"use client";

import { Children, type ReactNode } from "react";
import { findTermSpans } from "@/lib/glossary/highlight";
import { useGlossaryHighlight } from "@/components/glossary/GlossaryHighlightProvider";

export function HighlightPhrase({ children }: { children: ReactNode }) {
  const ctx = useGlossaryHighlight();
  if (!ctx || ctx.needles.length === 0) return <>{children}</>;

  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child === "string" || typeof child === "number") {
          return renderSpans(String(child), ctx);
        }
        return child;
      })}
    </>
  );
}

function renderSpans(
  text: string,
  ctx: NonNullable<ReturnType<typeof useGlossaryHighlight>>
): ReactNode {
  const spans = findTermSpans(text, ctx.needles);
  if (spans.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) out.push(text.slice(cursor, span.start));
    const slice = text.slice(span.start, span.end);
    const active = ctx.activeTermId === span.termId;
    out.push(
      <button
        key={`${span.termId}-${span.start}-${i}`}
        type="button"
        className={`luna-term-mark${active ? " is-active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.openTerm(span.termId, e.currentTarget);
        }}
      >
        {slice}
      </button>
    );
    cursor = span.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
