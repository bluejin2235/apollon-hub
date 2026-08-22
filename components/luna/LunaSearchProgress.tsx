"use client";

import { useState } from "react";
import type { LunaSearchCounts } from "@/lib/luna/luna-answer-ui";
import {
  buildProgressRows,
  progressSummary,
  type LunaProgressRow
} from "@/lib/luna/luna-answer-ui";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";

function ProgressDot({ state }: { state: LunaProgressRow["state"] }) {
  if (state === "done") {
    return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#0F6E56]" />;
  }
  if (state === "now") {
    return (
      <span className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-[#534AB7]" />
    );
  }
  return <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#e7e8ec]" />;
}

export function LunaSearchProgress({
  steps,
  classification,
  counts,
  isComplete
}: {
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  isComplete: boolean;
}) {
  const [open, setOpen] = useState(!isComplete);
  const rows = buildProgressRows({ steps, classification, counts, isComplete });

  if (isComplete && !open) {
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

  return (
    <div className="mb-3 overflow-hidden rounded-[11px] border border-[#e7e8ec] bg-[#FCFCFD]">
      {isComplete ? (
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
      {rows.map((row) => (
        <div
          key={row.key}
          className={`flex items-center gap-2 border-b border-[#eef0f3] px-3.5 py-2 text-[12px] last:border-b-0 ${
            row.state === "now"
              ? "bg-[#FBFAFF] font-semibold text-[#1c1d21]"
              : row.state === "done"
                ? "text-[#6b6f76]"
                : "text-[#9aa0a8]"
          }`}
        >
          <ProgressDot state={row.state} />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          {row.sub ? (
            <span className="shrink-0 text-[10.5px] font-normal text-[#9aa0a8]">
              {row.sub}
            </span>
          ) : null}
          {typeof row.ms === "number" ? (
            <span className="shrink-0 font-mono text-[10.5px] text-[#9aa0a8]">
              {row.ms}ms
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
