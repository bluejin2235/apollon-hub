"use client";

import { useState } from "react";
import type { MemoryAskPayload } from "@/lib/luna/memory-ask-shared";
import { supabase } from "@/lib/supabase/client";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** 답 아래 한 줄 묻기 — 대화를 끊지 않는다 */
export function MemoryAsk({
  messageId,
  ask,
  initialAnswer
}: {
  messageId: string;
  ask: MemoryAskPayload;
  initialAnswer?: "accept" | "reject" | null;
}) {
  const [answer, setAnswer] = useState<"accept" | "reject" | null>(
    initialAnswer ?? null
  );
  const [busy, setBusy] = useState(false);

  async function choose(next: "accept" | "reject") {
    if (busy || answer) return;
    setBusy(true);
    setAnswer(next);
    try {
      const token = await getAccessToken();
      if (!token) {
        setAnswer(null);
        return;
      }
      const res = await fetch("/api/luna/memory-ask", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message_id: messageId, answer: next })
      });
      if (!res.ok) setAnswer(null);
    } catch {
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  if (answer) {
    return (
      <div className="mt-2.5 rounded-[10px] border border-[#DDD9FB] bg-[#F0EFFE] px-3.5 py-3 text-[12px] text-[#534AB7]">
        {answer === "accept" ? "알겠어요. 다음에 그렇게 볼게요." : "알겠어요. 그때그때 볼게요."}
      </div>
    );
  }

  return (
    <div className="mt-2.5 rounded-[10px] border border-[#DDD9FB] bg-[#F0EFFE] px-3.5 py-3">
      <p className="mb-2.5 text-[12.5px] font-bold leading-relaxed text-[#534AB7]">
        {ask.question}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose("accept")}
          className="rounded-lg border border-[#DDD9FB] bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-[#534AB7] hover:bg-[#F7F6FC]"
        >
          {ask.options[0]}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose("reject")}
          className="rounded-lg border border-[#DDD9FB] bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-[#534AB7] hover:bg-[#F7F6FC]"
        >
          {ask.options[1]}
        </button>
      </div>
    </div>
  );
}
