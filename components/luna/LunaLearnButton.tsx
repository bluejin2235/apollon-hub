"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import { GraduationCap, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type PanelPhase = "input" | "confirm" | "done";

type LearnStatus = "ok" | "duplicate" | "conflict";

type LearnResult = {
  status: LearnStatus;
  message: string;
  content: string;
  category: string;
  removed: string;
  existing?: string;
  conflict_with?: string;
  id?: string;
  week_count: number;
};

const CATEGORIES = [
  { key: "term", label: "용어" },
  { key: "criterion", label: "판단기준" },
  { key: "workflow", label: "업무방식" },
  { key: "client", label: "클라이언트" },
  { key: "preference", label: "선호" }
] as const;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaLearnButton() {
  const reactId = useId();
  const fabId = `luna-learn-fab-${reactId.replace(/:/g, "")}`;
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PanelPhase>("input");
  const [text, setText] = useState("");
  const [rawText, setRawText] = useState("");
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LearnResult | null>(null);
  const [category, setCategory] = useState("term");
  const [weekCount, setWeekCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!cancelled) setAuthed(Boolean(session?.user));
    };
    void sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setAuthed(false);
        setOpen(false);
        setPhase("input");
        setResult(null);
        return;
      }
      setAuthed(Boolean(session?.user));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 패널을 연 클릭/포인터 이벤트가 바깥 클릭으로 바로 닫히지 않도록 한 틱 뒤에 등록
  useEffect(() => {
    if (!open) return;
    let enabled = false;
    const enableTimer = window.setTimeout(() => {
      enabled = true;
    }, 0);

    const onPointerDown = (e: PointerEvent) => {
      if (!enabled) return;
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (fabRef.current?.contains(t)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(enableTimer);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const loadWeekCount = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/luna/learn", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = (await res.json()) as { week_count?: number };
      setWeekCount(data.week_count ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (open && authed) void loadWeekCount();
  }, [open, authed, loadWeekCount]);

  const resetToInput = () => {
    setPhase("input");
    setText("");
    setRawText("");
    setRevision("");
    setResult(null);
    setError(null);
    setCategory("term");
  };

  const submitLearn = async (
    inputText: string,
    opts?: { category?: string; force?: "replace" | "both" }
  ) => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/learn", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: inputText,
          category: opts?.category,
          force: opts?.force
        })
      });
      if (!res.ok) {
        setError((await res.text()) || "요청에 실패했습니다");
        return;
      }
      const data = (await res.json()) as LearnResult;
      setResult(data);
      setCategory(data.category || "term");
      setWeekCount(data.week_count ?? weekCount);
      setRawText(inputText);
      setPhase("confirm");
      if (data.status === "ok") setRevision("");
    } catch (err) {
      console.error("[luna/learn]", err);
      setError("요청에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const onSendInput = () => {
    const t = text.trim();
    if (!t || busy) return;
    void submitLearn(t);
  };

  const onSaveConfirm = async () => {
    if (!result || busy) return;
    const rev = revision.trim();
    if (rev) {
      void submitLearn(rev);
      return;
    }
    if (result.status === "ok" && result.id && category !== result.category) {
      const token = await getAccessToken();
      if (!token) return;
      setBusy(true);
      try {
        await fetch("/api/luna/learn", {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ id: result.id, category })
        });
      } catch (err) {
        console.error("[luna/learn] patch category", err);
      } finally {
        setBusy(false);
      }
    }
    if (result.status === "ok") {
      setPhase("done");
      void loadWeekCount();
    }
  };

  const toggleOpen = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open && phase === "done") resetToInput();
    setOpen((prev) => !prev);
  };

  if (!mounted || !authed) return null;

  const ui = (
    <>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="루나에게 알려주기"
          className="fixed flex w-[300px] flex-col rounded-xl border border-[#D3D1C7] bg-white"
          style={{
            right: 20,
            bottom: 70,
            zIndex: 70,
            maxHeight: "min(70vh, 560px)",
            boxShadow: "0 6px 24px rgba(0,0,0,.09)"
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2.5">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#534AB7] text-xs font-semibold text-white"
              aria-hidden
            >
              L
            </div>
            <p className="min-w-0 flex-1 text-[13px] font-semibold text-slate-900">
              루나에게 알려주기
            </p>
            <button
              type="button"
              aria-label="닫기"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
            {error ? (
              <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                {error}
              </p>
            ) : null}

            {phase === "input" ? (
              <div className="space-y-2">
                <p className="rounded bg-slate-50 px-[9px] py-[7px] text-[11px] leading-relaxed text-slate-600">
                  아폴론에 대해 알아두면 좋을 것을 알려주세요. 용어, 판단 기준,
                  일하는 방식 무엇이든 좋아요.
                </p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  disabled={busy}
                  placeholder="예: 제안서 표지는 항상 다크 톤을 써요"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSendInput();
                    }
                  }}
                  className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-800 outline-none focus:border-[#534AB7]"
                />
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={onSendInput}
                  className="w-full rounded-lg bg-[#534AB7] py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
                >
                  {busy ? "정리 중…" : "알려주기"}
                </button>
              </div>
            ) : null}

            {phase === "confirm" && result ? (
              <div className="space-y-2.5">
                <div className="flex justify-end">
                  <div className="max-w-[90%] rounded-[12px_12px_2px_12px] bg-[#EEEDFE] px-2.5 py-1.5 text-[12px] text-[#26215C]">
                    {rawText}
                  </div>
                </div>

                {result.status === "duplicate" ? (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-[12px] text-slate-700">
                      이미 알고 있어요
                    </div>
                    {(result.existing || result.content) && (
                      <p className="border-l-2 border-slate-300 pl-2 text-[11.5px] text-slate-600">
                        {result.existing || result.content}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        resetToInput();
                      }}
                      className="w-full rounded-lg border border-slate-200 py-1.5 text-[12px] text-slate-700"
                    >
                      닫기
                    </button>
                  </div>
                ) : null}

                {result.status === "conflict" ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
                      <p className="font-medium">
                        {result.message || "기존 지식과 충돌해요"}
                      </p>
                      {result.conflict_with ? (
                        <p className="mt-1 text-[11.5px] text-amber-900/90">
                          {result.conflict_with}
                        </p>
                      ) : null}
                    </div>
                    {result.content ? (
                      <div className="border-l-2 border-[#534AB7] pl-2 text-[11.5px] leading-relaxed text-slate-800">
                        {result.content}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void submitLearn(rawText, {
                            category,
                            force: "replace"
                          })
                        }
                        className="rounded-lg bg-[#534AB7] py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                      >
                        기존 것 바꾸기
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void submitLearn(rawText, {
                            category,
                            force: "both"
                          })
                        }
                        className="rounded-lg border border-slate-300 py-1.5 text-[12px] text-slate-800 disabled:opacity-50"
                      >
                        둘 다 두기
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={resetToInput}
                        className="rounded-lg py-1.5 text-[12px] text-slate-500"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : null}

                {result.status === "ok" ? (
                  <div className="space-y-2">
                    <div className="rounded-[12px_12px_12px_2px] bg-slate-100 px-2.5 py-1.5 text-[12px] text-slate-800">
                      {result.message || "이렇게 기억할게요"}
                    </div>
                    {result.content ? (
                      <div className="border-l-2 border-[#534AB7] pl-2 text-[11.5px] leading-relaxed text-slate-800">
                        {result.content}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-1">
                      {CATEGORIES.map((c) => {
                        const active = category === c.key;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setCategory(c.key)}
                            className="rounded-full px-2 py-0.5 text-[10.5px]"
                            style={{
                              backgroundColor: active ? "#E1F5EE" : "#F1F0EF",
                              color: active ? "#04342C" : "#6B7280",
                              border: active
                                ? "1px solid #0F6E56"
                                : "1px solid transparent"
                            }}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    {result.removed ? (
                      <p className="text-[10.5px] text-amber-700">
                        제외한 내용: {result.removed}
                      </p>
                    ) : null}
                    <input
                      value={revision}
                      onChange={(e) => setRevision(e.target.value)}
                      disabled={busy}
                      placeholder="고칠 게 있으면 적어주세요"
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[#534AB7]"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onSaveConfirm()}
                      className="w-full rounded-lg bg-[#534AB7] py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
                    >
                      {busy ? "저장 중…" : "저장"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {phase === "done" ? (
              <div className="space-y-2">
                <div className="rounded-lg bg-[#E1F5EE] px-2.5 py-2 text-[12px] text-[#04342C]">
                  기억했어요. 다음 질문부터 바로 씁니다.
                </div>
                <p className="text-[10.5px] text-gray-500">
                  이번 주에 {weekCount}개 알려주셨어요
                </p>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  placeholder="더 알려주기"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const t = text.trim();
                      if (!t || busy) return;
                      setPhase("input");
                      void submitLearn(t);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[#534AB7]"
                />
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={() => {
                    const t = text.trim();
                    if (!t) return;
                    setPhase("input");
                    void submitLearn(t);
                  }}
                  className="w-full rounded-lg border border-[#534AB7] py-1.5 text-[12px] text-[#534AB7] disabled:opacity-50"
                >
                  알려주기
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        ref={fabRef}
        id={fabId}
        type="button"
        title="루나에게 알려주기"
        aria-label="루나에게 알려주기"
        aria-expanded={open}
        onClick={toggleOpen}
        className="fixed flex h-10 w-10 items-center justify-center rounded-full bg-[#534AB7] text-white transition hover:scale-105"
        style={{
          right: 20,
          bottom: 20,
          zIndex: 70,
          boxShadow: "0 3px 12px rgba(83,74,183,.32)"
        }}
      >
        <GraduationCap className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>
    </>
  );

  return createPortal(ui, document.body);
}
