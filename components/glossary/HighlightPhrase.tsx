"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useRef,
  type MutableRefObject,
  type ReactNode
} from "react";
import { findTermSpans, isSourceBlock, isSourceLine } from "@/lib/glossary/highlight";
import { useGlossaryHighlight } from "@/components/glossary/GlossaryHighlightProvider";

const HighlightUsedContext = createContext<MutableRefObject<Set<string>> | null>(
  null
);

/** 한 메시지·문서에서 용어당 첫 표시만. 매 렌더 시작 시 집합을 비운다. */
export function HighlightScope({ children }: { children: ReactNode }) {
  const usedRef = useRef(new Set<string>());
  usedRef.current.clear();
  return (
    <HighlightUsedContext.Provider value={usedRef}>
      {children}
    </HighlightUsedContext.Provider>
  );
}

export function useHighlightUsed() {
  return useContext(HighlightUsedContext);
}

export function flattenPlain(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenPlain).join("");
  if (isValidElement(node)) {
    return flattenPlain(
      (node.props as { children?: ReactNode }).children
    );
  }
  return "";
}

export function HighlightPhrase({ children }: { children: ReactNode }) {
  const ctx = useGlossaryHighlight();
  const usedRef = useHighlightUsed();
  if (!ctx || ctx.needles.length === 0) return <>{children}</>;
  const used = usedRef?.current ?? null;
  const joined = flattenPlain(children);
  if (isSourceBlock(joined)) return <>{children}</>;

  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child === "string" || typeof child === "number") {
          return renderText(String(child), ctx, used);
        }
        return child;
      })}
    </>
  );
}

function renderText(
  text: string,
  ctx: NonNullable<ReturnType<typeof useGlossaryHighlight>>,
  used: Set<string> | null
): ReactNode {
  if (!text.includes("\n")) return renderSpans(text, ctx, used);
  const parts = text.split(/(\n)/);
  return parts.map((part, i) => {
    if (part === "\n") return "\n";
    if (isSourceLine(part)) return <span key={`src-${i}`}>{part}</span>;
    return (
      <span key={`hl-${i}`}>
        {renderSpans(part, ctx, used)}
      </span>
    );
  });
}

function renderSpans(
  text: string,
  ctx: NonNullable<ReturnType<typeof useGlossaryHighlight>>,
  used: Set<string> | null
): ReactNode {
  const spans = findTermSpans(text, ctx.needles, used ?? undefined);
  if (spans.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) out.push(text.slice(cursor, span.start));
    const slice = text.slice(span.start, span.end);
    const active = ctx.activeTermId === span.termId;
    used?.add(span.termId);
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
