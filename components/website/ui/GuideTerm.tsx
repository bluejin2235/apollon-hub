"use client";

import {
  createContext,
  useContext,
  useRef,
  type ReactNode
} from "react";

import { GuidePopover } from "./GuidePopover";

const SeenTermsContext = createContext<Set<string> | null>(null);

export function GuideTermProvider({ children }: { children: ReactNode }) {
  const seen = useRef(new Set<string>());
  return (
    <SeenTermsContext.Provider value={seen.current}>
      {children}
    </SeenTermsContext.Provider>
  );
}

export function GuideTerm({
  anchorId,
  termKey,
  children
}: {
  anchorId: string;
  /** 같은 화면에서 중복 밑줄 방지 키. 기본값은 children 문자열 */
  termKey?: string;
  children: ReactNode;
}) {
  const seen = useContext(SeenTermsContext);
  const dedupeKey =
    termKey ??
    (typeof children === "string" ? children.trim() : anchorId);
  if (seen?.has(dedupeKey)) {
    return <>{children}</>;
  }
  seen?.add(dedupeKey);
  return <GuidePopover anchorId={anchorId}>{children}</GuidePopover>;
}
