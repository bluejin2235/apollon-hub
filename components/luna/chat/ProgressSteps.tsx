"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import {
  buildProgressRows,
  progressSummary,
  type LunaSearchCounts
} from "@/lib/luna/luna-answer-ui";
import { PROGRESS_MOBILE_MAX_VISIBLE } from "@/lib/luna/progress-display";

function ProgressMark({ state }: { state: "done" | "now" | "wait" }) {
  if (state === "done") {
    return (
      <span
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] leading-none text-[#8B8F96]"
        aria-hidden
      >
        ✓
      </span>
    );
  }
  if (state === "now") {
    return (
      <span
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[#c8cad0] border-t-[#534AB7]"
        aria-hidden
      />
    );
  }
  return (
    <span
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] leading-none text-[#c8cad0]"
      aria-hidden
    >
      ◌
    </span>
  );
}

function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia("(max-width: 640px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getMobileSnapshot() {
  return window.matchMedia("(max-width: 640px)").matches;
}

function getMobileServerSnapshot() {
  return false;
}

export function ProgressSteps({
  steps,
  classification,
  counts,
  isComplete,
  forceExpanded
}: {
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  isComplete: boolean;
  /** 대기·스트리밍 중 — 접힌 「찾는 과정 ▸」 금지 */
  forceExpanded?: boolean;
}) {
  const [open, setOpen] = useState(!isComplete);
  const [expanded, setExpanded] = useState(false);
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  useEffect(() => {
    if (forceExpanded) setOpen(true);
    else if (isComplete) setOpen(false);
  }, [forceExpanded, isComplete]);

  const rows = buildProgressRows({ steps, classification, counts, isComplete });
  if (rows.length === 0 && !forceExpanded) return null;

  if (rows.length === 0 && forceExpanded) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-[11px] border border-[#e7e8ec] bg-[#FCFCFD] px-3.5 py-2.5">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[#c8cad0] border-t-[#534AB7]" />
        <span className="text-[12.5px] text-[#6b6f76]">답변 준비 중…</span>
      </div>
    );
  }

  const keepOpen = forceExpanded || !isComplete;

  if (isComplete && !open && !keepOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 flex w-full items-center gap-[7px] rounded-[11px] border border-[#e7e8ec] bg-[#FCFCFD] px-3.5 py-2 text-left text-[11px] text-[#9aa0a8]"
      >
        <span>▸</span>
        <span>찾는 과정</span>
        <span className="flex-1" />
        <span>{progressSummary(counts)}</span>
      </button>
    );
  }

  const needsCollapse =
    keepOpen && isMobile && rows.length > PROGRESS_MOBILE_MAX_VISIBLE;
  const visibleRows =
    needsCollapse && !expanded
      ? rows.slice(-PROGRESS_MOBILE_MAX_VISIBLE)
      : rows;

  return (
    <div className="mb-3 overflow-hidden rounded-[11px] border border-[#e7e8ec] bg-[#FCFCFD]">
      {isComplete && !keepOpen ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-[7px] border-b border-[#eef0f3] px-3.5 py-2 text-left text-[11px] text-[#9aa0a8]"
        >
          <span>▾</span>
          <span>찾는 과정</span>
          <span className="flex-1" />
          <span>{progressSummary(counts)}</span>
        </button>
      ) : null}
      <div className="border-l-2 border-[#e7e8ec] py-1 pl-1 max-md:border-l-[3px]">
        {needsCollapse && !expanded && rows.length > visibleRows.length ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-3 py-1 text-[10.5px] text-[#9aa0a8] hover:text-[#6b6f76] max-md:block md:hidden"
          >
            이전 {rows.length - visibleRows.length}단계 ▸
          </button>
        ) : null}
        {visibleRows.map((row) => (
          <div
            key={row.key}
            className={`flex items-center gap-2 px-3 py-[6px] text-[12px] ${
              row.state === "now"
                ? "font-medium text-[#1c1d21]"
                : row.state === "done"
                  ? "text-[#8B8F96]"
                  : "text-[#b0b4ba]"
            }`}
          >
            <ProgressMark state={row.state} />
            <span className="min-w-0 flex-1">
              {row.label}
              {row.sub ? (
                <span className="text-[#9aa0a8]"> — {row.sub}</span>
              ) : null}
            </span>
            {row.right || typeof row.ms === "number" ? (
              <span className="w-[4.5rem] shrink-0 text-right font-mono text-[10.5px] tabular-nums text-[#9aa0a8]">
                {row.right ??
                  (typeof row.ms === "number"
                    ? `${(row.ms / 1000).toFixed(1)}초`
                    : "")}
              </span>
            ) : (
              <span className="w-[4.5rem] shrink-0" />
            )}
          </div>
        ))}
        {needsCollapse && expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="px-3 py-1 text-[10.5px] text-[#9aa0a8] hover:text-[#6b6f76] max-md:block md:hidden"
          >
            접기
          </button>
        ) : null}
      </div>
    </div>
  );
}
