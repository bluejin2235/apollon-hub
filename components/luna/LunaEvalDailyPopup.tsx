"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Assignment = {
  id: string;
  result_id: string;
  assigned_at: string;
  question: string;
  answer: string;
  case_id: string | null;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function snoozeKey(id: string) {
  return `luna_eval_daily_snooze_${id}`;
}

function isSnoozed(id: string): boolean {
  try {
    const raw = localStorage.getItem(snoozeKey(id));
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && Date.now() < until;
  } catch {
    return false;
  }
}

function setSnooze(id: string) {
  try {
    localStorage.setItem(snoozeKey(id), String(Date.now() + 24 * 60 * 60 * 1000));
  } catch {
    /* ignore */
  }
}

export function LunaEvalDailyPopup() {
  const pathname = usePathname();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [visible, setVisible] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);

  const showOnPath =
    Boolean(pathname?.startsWith("/luna")) || Boolean(pathname?.startsWith("/research"));

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setAssignment(null);
      setVisible(false);
      return;
    }
    const res = await fetch("/api/luna/eval/daily", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setAssignment(null);
      setVisible(false);
      return;
    }
    const json = (await res.json()) as { assignment?: Assignment | null };
    const a = json.assignment ?? null;
    if (!a || isSnoozed(a.id)) {
      setAssignment(a);
      setVisible(false);
      return;
    }
    setAssignment(a);
    setVisible(true);
    setScore(null);
    setComment("");
    setAnswerOpen(false);
  }, []);

  useEffect(() => {
    if (!showOnPath) return;
    void load();
  }, [showOnPath, load]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (!showOnPath || !visible || !assignment) return null;

  const fabSize = narrow ? 44 : 56;
  const fabRight = narrow ? 14 : 20;

  async function submit() {
    if (!assignment || score == null || busy) return;
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch("/api/luna/eval/daily", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: assignment.id,
          score,
          comment: comment.trim() || null
        })
      });
      if (!res.ok) return;
      setVisible(false);
      setAssignment(null);
    } finally {
      setBusy(false);
    }
  }

  function later() {
    if (!assignment) return;
    setSnooze(assignment.id);
    setVisible(false);
  }

  return (
    <div
      className="fixed flex flex-col border border-[#D3D1C7] bg-white"
      style={{
        right: fabRight,
        bottom: `calc(var(--bottom-ui, 0px) + 12px + ${fabSize}px + 12px)`,
        zIndex: 65,
        width: narrow ? "min(310px, calc(100vw - 28px))" : 310,
        borderRadius: 16,
        boxShadow: "0 8px 28px rgba(0,0,0,0.10)"
      }}
      role="dialog"
      aria-label="마이크로 평가"
    >
      <div className="border-b border-[#E4E2DA] px-3.5 py-3">
        <p className="text-[13px] font-semibold text-slate-900">
          루나가 이 질문에 이렇게 답했어요 — 몇 점인가요?
        </p>
      </div>
      <div className="space-y-2.5 px-3.5 py-3">
        <p className="text-[12px] font-medium text-slate-800">{assignment.question}</p>
        <div>
          <button
            type="button"
            onClick={() => setAnswerOpen((v) => !v)}
            className="text-[11px] font-medium text-[#534AB7]"
          >
            {answerOpen ? "답변 접기" : "답변 보기"}
          </button>
          {answerOpen ? (
            <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
              {assignment.answer || "(응답 없음)"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              className={`h-7 w-7 rounded-md text-[11px] font-medium ${
                score === n
                  ? "bg-[#534AB7] text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="코멘트 (선택)"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px]"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || score == null}
            onClick={() => void submit()}
            className="flex-1 rounded-lg bg-[#534AB7] px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            제출
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={later}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  );
}
