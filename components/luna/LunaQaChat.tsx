"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LunaInput } from "@/components/luna/LunaInput";
import { confirmOptions, type QaItem, type QaOption, type QaPending, type QaSessionView, type QaSummary } from "@/lib/luna/qa-options";
import { supabase } from "@/lib/supabase/client";

async function token(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function qaFetch(body?: Record<string, unknown>): Promise<QaSessionView | null> {
  const t = await token();
  if (!t) throw new Error("login");
  const res = await fetch("/api/luna/qa", {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { session?: QaSessionView | null };
  return json.session ?? null;
}

function OptionList({
  options,
  primary,
  busy,
  onPick
}: {
  options: QaOption[];
  primary?: string;
  busy?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-4 pb-3">
      {options.map((opt, i) => {
        const on = primary === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(opt.id)}
            className={`flex items-center gap-2.5 rounded-[11px] border px-3.5 py-3 text-left text-[13px] font-semibold disabled:opacity-50 ${
              on
                ? "border-[#534AB7] bg-[#EEEDFE] text-[#534AB7]"
                : "border-[#e7e8ec] bg-white"
            }`}
          >
            <span
              className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-[11px] font-extrabold ${
                on ? "bg-[#534AB7] text-white" : "bg-[#F3F4F6] text-[#9aa0a8]"
              }`}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              {opt.label}
              {opt.sub ? (
                <span className="mt-0.5 block text-[10.5px] font-medium text-[#9aa0a8]">
                  {opt.sub}
                </span>
              ) : null}
            </span>
            {opt.id === "other" ? <span className="text-[15px] text-[#534AB7]">🎙</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Evidence({ item }: { item: QaItem }) {
  const hasPairs = Boolean(item.pairs?.length);
  const stats = (item.stats ?? []).filter((s) => s.trim().length > 0);
  const why =
    item.why && item.why.trim() && item.why.trim() !== item.question.trim()
      ? item.why
      : null;
  const title = item.evidence_title?.trim() || "";
  if (!hasPairs && stats.length === 0 && !item.metrics && !why && !title) return null;
  return (
    <div className="mt-2 rounded-[9px] border border-[#e7e8ec] bg-[#FAFAFB] px-3 py-2.5 text-[11.5px] leading-relaxed">
      {hasPairs ? (
        <>
          <div className="mb-1.5 text-[10px] font-extrabold text-[#9aa0a8]">
            {title || "이렇게 잘못 연결한 것이 있었어요"}
          </div>
          {item.pairs!.map((p, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.left.name}</div>
                {p.left.path ? (
                  <div className="break-all font-mono text-[10px] text-[#9aa0a8]">
                    {p.left.path}
                  </div>
                ) : null}
              </div>
              <span className="text-[#9aa0a8]">=</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p.right.name}</div>
                {p.right.path ? (
                  <div className="break-all font-mono text-[10px] text-[#9aa0a8]">
                    {p.right.path}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </>
      ) : title ? (
        <div className="mb-1.5 text-[10px] font-extrabold text-[#9aa0a8]">{title}</div>
      ) : null}
      {stats.length > 0
        ? stats.map((line) => (
            <div key={line} className="text-[11.5px] text-[#1c1d21]">
              {line}
            </div>
          ))
        : null}
      {item.metrics ? (
        <div className="mt-1 text-[11px] text-[#6b6f76]">{item.metrics}</div>
      ) : null}
      {why ? (
        <div className="mt-2 border-l-2 border-[#e7e8ec] pl-2.5 text-[11px] leading-relaxed text-[#9aa0a8]">
          {why}
        </div>
      ) : null}
    </div>
  );
}

function PendingBubble({ pending }: { pending: QaPending }) {
  return (
    <div>
      이렇게 이해했어요.
      <div className="mt-2 rounded-[9px] border border-[#e7e8ec] bg-[#FAFAFB] px-3 py-2.5 text-[11.5px] leading-relaxed">
        <div className="mb-1 text-[10px] font-extrabold text-[#9aa0a8]">1 · 지금 물어본 것</div>
        <b>{pending.current.summary}</b>
        {pending.extra ? (
          <>
            <div className="mb-1 mt-2.5 text-[10px] font-extrabold text-[#9aa0a8]">
              2 · 새로 알려주신 것
            </div>
            <b>{pending.extra.summary}</b>
          </>
        ) : null}
      </div>
      {pending.extra ? (
        <div className="mt-2 border-l-2 border-[#e7e8ec] pl-2.5 text-[11px] text-[#9aa0a8]">
          2번은 새 규칙이라 따로 여쭤볼게요. 맞나요?
        </div>
      ) : null}
    </div>
  );
}

function DoneCard({ summary, onClose }: { summary: QaSummary; onClose: () => void }) {
  return (
    <div className="mx-4 mb-3 rounded-[11px] border border-[#BEE0D3] bg-[#E6F5EF] px-4 py-4 text-center">
      <div className="mb-1 text-[14px] font-extrabold text-[#0F6E56]">
        {summary.asked}건 다 여쭤봤어요. {summary.resolved}건이 정리됐습니다.
      </div>
      <div className="mb-3 text-left text-[11.5px] leading-relaxed text-[#0F6E56]">
        {summary.rules.length > 0 ? (
          <>
            규칙 {summary.rules.length}개
            <ul className="mt-1">
              {summary.rules.map((r) => (
                <li key={r.text}>
                  · {r.text.slice(0, 40)}
                  {r.impact ? ` → ${r.impact}건` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="mt-2">
          답 {summary.answers.good + summary.answers.bad + summary.answers.skip}건 — 맞다{" "}
          {summary.answers.good} · 틀리다 {summary.answers.bad} · 넘김 {summary.answers.skip}
        </div>
        {summary.answers.bad > 0 ? (
          <div className="mt-1">
            틀리다고 하신 {summary.answers.bad}건은 오늘 밤 자습이 원인을 찾아볼게요.
          </div>
        ) : null}
      </div>
      <div className="flex justify-center gap-2">
        <Link
          href="/settings?menu=selfstudy&sub=learned"
          className="rounded-lg bg-[#0F6E56] px-4 py-2 text-[11.5px] font-bold text-white"
        >
          배운 것 보기
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#BEE0D3] bg-white px-4 py-2 text-[11.5px] font-bold text-[#0F6E56]"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

export function LunaQaChat() {
  const [session, setSession] = useState<QaSessionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listenTick, setListenTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const boot = useCallback(async () => {
    try {
      setError("");
      const row = await qaFetch({ action: "start" });
      setSession(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.cursor, session?.pending, session?.finished_at]);

  const item: QaItem | null = useMemo(() => {
    if (!session || session.finished_at) return null;
    return session.items[session.cursor] ?? null;
  }, [session]);

  const total = session?.items.length ?? 0;
  const at = session ? Math.min(session.cursor + (session.finished_at ? 0 : 1), total) : 0;
  const pct = total > 0 ? Math.round((session!.cursor / total) * 100) : 0;

  async function restart() {
    if (busy) return;
    setBusy(true);
    try {
      setError("");
      const row = await qaFetch({ action: "restart" });
      setSession(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : "다시 시작 실패");
    } finally {
      setBusy(false);
    }
  }

  async function pick(optionId: string, transcript?: string) {
    if (!session || busy) return;
    if (optionId === "other") {
      setListenTick((n) => n + 1);
      return;
    }
    setBusy(true);
    try {
      const next = await qaFetch({
        action: "answer",
        session_id: session.id,
        option_id: optionId,
        transcript
      });
      if (next) setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <p className="p-8 text-center text-sm text-slate-400">불러오는 중…</p>;
  }

  if (!session || session.items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <p className="text-[16px] font-extrabold text-slate-900">지금은 여쭤볼 게 없어요</p>
        <p className="mt-2 text-[13px] text-slate-500">나중에 규칙이나 답이 쌓이면 여기로 올게요.</p>
        <Link
          href="/luna"
          className="mt-6 inline-flex rounded-xl bg-[#534AB7] px-5 py-3 text-[13px] font-bold text-white"
        >
          루나와 대화하기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#eef0f3] px-4 py-3">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#534AB7] text-[11px] font-extrabold text-white">
          L
        </span>
        <span className="flex-1 text-[13px] font-bold">
          {session.finished_at ? "문답 끝" : "문답 중"}
        </span>
        <span className="font-mono text-[11px] text-[#9aa0a8]">
          {Math.min(at, total)} / {total}
        </span>
        {!session.finished_at ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void restart()}
            className="text-[11px] font-semibold text-[#9aa0a8] disabled:opacity-50"
          >
            다시 시작
          </button>
        ) : null}
        <Link href="/settings?menu=selfstudy&sub=ask" className="text-[15px] text-[#9aa0a8]">
          ✕
        </Link>
      </div>
      <div className="h-[3px] bg-[#eef0f3]">
        <i className="block h-full bg-[#534AB7]" style={{ width: `${pct}%` }} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-3.5 flex gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#534AB7] text-[10px] font-extrabold text-white">
            L
          </span>
          <p className="text-[12.5px] leading-relaxed">
            {total}건을 물어볼게요. <b>규칙부터</b> 여쭤볼게요 — 하나 정하면 여러 건이 한 번에
            정리돼요.
          </p>
        </div>

        {item ? (
          <div className="mb-3.5 flex gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#534AB7] text-[10px] font-extrabold text-white">
              L
            </span>
            <div className="min-w-0 text-[12.5px] leading-relaxed">
              <b>{item.question}</b>
              <Evidence item={item} />
            </div>
          </div>
        ) : null}

        {session.pending ? (
          <>
            <div className="mb-3.5 flex justify-end">
              <div className="max-w-[88%] rounded-[14px_14px_3px_14px] bg-[#534AB7] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-white">
                {session.pending.transcript}
              </div>
            </div>
            <div className="mb-3.5 flex gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#534AB7] text-[10px] font-extrabold text-white">
                L
              </span>
              <div className="min-w-0 text-[12.5px] leading-relaxed">
                <PendingBubble pending={session.pending} />
              </div>
            </div>
          </>
        ) : null}

        {session.finished_at && session.summary ? (
          <DoneCard
            summary={session.summary}
            onClose={() => {
              window.location.href = "/luna";
            }}
          />
        ) : null}
        {error ? <p className="text-[12px] text-[#B3403A]">{error}</p> : null}
        <div ref={bottomRef} />
      </div>

      {!session.finished_at && item && !session.pending ? (
        <OptionList
          options={item.options}
          primary={item.options[0]?.id}
          busy={busy}
          onPick={(id) => void pick(id)}
        />
      ) : null}
      {!session.finished_at && session.pending ? (
        <OptionList
          options={confirmOptions(Boolean(session.pending.extra))}
          primary="both"
          busy={busy}
          onPick={(id) => void pick(id)}
        />
      ) : null}

      {!session.finished_at ? (
        <LunaInput
          conversationId={session.conversation_id}
          onEnsureConversation={async () => session.conversation_id}
          listenTick={listenTick}
          placeholder="번호를 누르거나 직접 쓰셔도 돼요"
          disabled={busy}
          onSend={(text) => {
            if (!text.trim()) return;
            void pick("voice", text.trim());
          }}
        />
      ) : null}
    </div>
  );
}
