"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useRef,
  type ReactNode
} from "react";
import {
  findTermSpans,
  isSourceBlock,
  isSourceLine,
  type HighlightSpan
} from "@/lib/glossary/highlight";
import {
  useGlossaryHighlightActive,
  useGlossaryHighlightData
} from "@/components/glossary/GlossaryHighlightProvider";

type HighlightBag = {
  resetKey: string;
  claimed: Set<string>;
  cache: Map<string, HighlightSpan[]>;
};

const HighlightUsedContext = createContext<HighlightBag | null>(null);

/** 본문(resetKey)이 바뀔 때만 하이라이트를 다시 계산한다. 팝업 상태와 분리. */
export function HighlightScope({
  resetKey,
  children
}: {
  resetKey: string;
  children: ReactNode;
}) {
  const bagRef = useRef<HighlightBag>({
    resetKey,
    claimed: new Set(),
    cache: new Map()
  });
  if (bagRef.current.resetKey !== resetKey) {
    bagRef.current = { resetKey, claimed: new Set(), cache: new Map() };
  }
  return (
    <HighlightUsedContext.Provider value={bagRef.current}>
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
    return flattenPlain((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function TermMark({ termId, text }: { termId: string; text: string }) {
  const data = useGlossaryHighlightData();
  const activeTermId = useGlossaryHighlightActive();
  const active = activeTermId === termId;
  return (
    <button
      type="button"
      className={`luna-term-mark${active ? " is-active" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        data?.openTerm(termId, e.currentTarget);
      }}
    >
      {text}
    </button>
  );
}

export function HighlightPhrase({ children }: { children: ReactNode }) {
  const data = useGlossaryHighlightData();
  if (!data || data.needles.length === 0) return <>{children}</>;
  if (isSourceBlock(flattenPlain(children))) return <>{children}</>;

  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child === "string" || typeof child === "number") {
          return <HighlightedChunk text={String(child)} />;
        }
        return child;
      })}
    </>
  );
}

function HighlightedChunk({ text }: { text: string }) {
  if (!text.includes("\n")) return <HighlightedLine text={text} />;
  return text.split(/(\n)/).map((part, i) => {
    if (part === "\n") return "\n";
    if (isSourceLine(part)) return part;
    return <HighlightedLine key={`ln-${i}`} text={part} />;
  });
}

function HighlightedLine({ text }: { text: string }) {
  const data = useGlossaryHighlightData();
  const bag = useHighlightUsed();
  const needles = data?.needles;
  const resetKey = bag?.resetKey ?? "";

  const spans = useMemo(() => {
    const list = needles ?? [];
    if (!text || list.length === 0 || isSourceLine(text)) return [] as HighlightSpan[];
    const cacheKey = `${resetKey}::${text}`;
    const cached = bag?.cache.get(cacheKey);
    if (cached) return cached;
    const next = findTermSpans(text, list, bag?.claimed);
    if (bag) {
      for (const span of next) bag.claimed.add(span.termId);
      bag.cache.set(cacheKey, next);
    }
    return next;
  }, [text, needles, resetKey, bag]);

  if (spans.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) out.push(text.slice(cursor, span.start));
    out.push(
      <TermMark
        key={`${span.termId}-${span.start}-${i}`}
        termId={span.termId}
        text={text.slice(span.start, span.end)}
      />
    );
    cursor = span.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
