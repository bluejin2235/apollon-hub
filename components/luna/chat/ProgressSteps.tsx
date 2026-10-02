"use client";

import { useEffect, useState } from "react";
import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import { buildProgressRows, type LunaSearchCounts } from "@/lib/luna/luna-answer-ui";

/** One current server-reported stage; never guess completion from elapsed time. */
export function ProgressSteps({ steps, classification, counts, isComplete, durationMs }: {
  steps: LunaProgressStep[];
  classification?: LunaClassificationMeta | null;
  counts: LunaSearchCounts;
  isComplete: boolean;
  forceExpanded?: boolean;
  durationMs?: number | null;
}) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (isComplete) return;
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isComplete, startedAt]);
  const rows = buildProgressRows({ steps, classification, counts, isComplete });
  const active = rows.filter(row => row.state === "now");
  const current = active.at(-1) ?? rows.filter(row => row.state === "done").at(-1);
  const failed = steps.some(step => step.key === "error");
  const stopped = steps.some(step => step.key === "stopped");
  const label = isComplete ? (stopped ? "답변 중지" : failed ? "검색 실패" : "검색 완료") : current?.label || "질문을 확인하고 있어요";
  const time = isComplete ? durationMs ?? (elapsed || null) : elapsed;
  return (
    <div className="mb-3 flex min-h-11 items-center gap-2 text-[13px] text-[#737c75]">
      <img src="/luna/luna-play.webp" width={32} height={32} alt="" className="h-8 w-8 shrink-0 object-contain" />
      <span role="status" aria-live="polite" className="min-w-0 flex-1 break-words">{label}</span>
      {time != null && <span className="shrink-0 tabular-nums" aria-label="경과 시간">{Math.floor(time / 1000)}초</span>}
    </div>
  );
}
