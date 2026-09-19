"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FOUND_REASONS,
  type FoundReason
} from "@/lib/luna/answer-found-shared";

type FoundPromptProps = {
  messageId: string;
  canSubmit: boolean;
};

type Phase = "ask" | "reason" | "done";

export function FoundPrompt({ messageId, canSubmit }: FoundPromptProps) {
  const [phase, setPhase] = useState<Phase>("ask");
  const [found, setFound] = useState<boolean | null>(null);
  const [reason, setReason] = useState<FoundReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!canSubmit || !messageId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/luna/answer-found?message_id=${encodeURIComponent(messageId)}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          found?: boolean | null;
          reason?: string | null;
        };
        if (cancelled) return;
        if (typeof data.found === "boolean") {
          setFound(data.found);
          setReason(
            FOUND_REASONS.includes(data.reason as FoundReason)
              ? (data.reason as FoundReason)
              : null
          );
          setPhase("done");
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canSubmit, messageId]);

  const submit = useCallback(
    async (nextFound: boolean, nextReason: FoundReason | null) => {
      if (!canSubmit || busy) return;
      setBusy(true);
      try {
        const res = await fetch("/api/luna/answer-found", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_id: messageId,
            found: nextFound,
            reason: nextReason
          })
        });
        if (!res.ok) return;
        setFound(nextFound);
        setReason(nextReason);
        setPhase("done");
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    },
    [busy, canSubmit, messageId]
  );

  if (!canSubmit || !loaded) return null;

  if (phase === "done" && found !== null) {
    return (
      <div className="mt-4 rounded-[12px] border border-[#e7e8ec] bg-[#FAFAFB] px-4 py-3.5">
        <p className="text-[13px] font-semibold text-[#1c1d21]">
          {found
            ? "네, 찾았어요 — 남겨 두었어요"
            : `아니요 — ${reason ?? "못 찾았어요"}`}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPhase("ask");
            setFound(null);
            setReason(null);
          }}
          className="mt-1.5 text-[11.5px] font-medium text-[#534AB7] hover:underline disabled:opacity-50"
        >
          다시 고르기
        </button>
      </div>
    );
  }

  if (phase === "reason") {
    return (
      <div className="mt-4 rounded-[12px] border border-[#E8E5F4] bg-[#F7F6FC] px-4 py-4">
        <p className="mb-3 text-[14px] font-bold text-[#1c1d21]">
          어떤 쪽에 가까워요?
        </p>
        <div className="flex flex-col gap-2">
          {FOUND_REASONS.map((r, i) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              onClick={() => void submit(false, r)}
              className="rounded-[10px] border border-[#e7e8ec] bg-white px-3.5 py-2.5 text-left text-[13.5px] text-[#1c1d21] transition hover:border-[#534AB7]/50 hover:bg-[#EEEDFE]/50 disabled:opacity-50"
            >
              <span className="mr-2 font-bold text-[#534AB7]">{i + 1}</span>
              {r}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPhase("ask")}
          className="mt-2.5 text-[11.5px] text-[#9aa0a8] hover:text-[#6b6f76]"
        >
          ← 뒤로
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-[12px] border border-[#E8E5F4] bg-[#F7F6FC] px-4 py-4">
      <p className="mb-3 text-[15px] font-bold tracking-[-0.2px] text-[#1c1d21]">
        이거 찾으시던 거 맞나요?
      </p>
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(true, null)}
          className="rounded-[10px] bg-[#534AB7] px-4 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-[#463FA0] disabled:opacity-50"
        >
          네, 찾았어요
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPhase("reason")}
          className="rounded-[10px] border border-[#e7e8ec] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#1c1d21] transition hover:border-[#534AB7]/40 hover:bg-white disabled:opacity-50"
        >
          아니요, 못 찾았어요
        </button>
      </div>
    </div>
  );
}
