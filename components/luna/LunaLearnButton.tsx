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
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type PanelPhase =
  | "input"
  | "confirm"
  | "done"
  | "question"
  | "question_answered";

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

type PendingQuestion = {
  id: string;
  question: string;
  context: string | null;
  options: string[] | null;
  category: string | null;
  source: string | null;
  created_at: string;
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

function teaserText(q: PendingQuestion): string {
  const ctx = q.context?.trim();
  if (ctx) return ctx;
  const qText = q.question.trim();
  return qText.length > 24 ? `${qText.slice(0, 24)}…` : qText;
}

export function LunaLearnButton() {
  const pathname = usePathname();
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
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(
    null
  );
  const [teaserReady, setTeaserReady] = useState(false);
  const [teaserDismissed, setTeaserDismissed] = useState(false);
  const [questionFreeText, setQuestionFreeText] = useState(false);
  const [questionAnswerDraft, setQuestionAnswerDraft] = useState("");
  const [answeredContent, setAnsweredContent] = useState<string | null>(null);
  const [answeredMessage, setAnsweredMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabWrapRef = useRef<HTMLDivElement>(null);

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
        setPendingQuestion(null);
        return;
      }
      setAuthed(Boolean(session?.user));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadPendingQuestion = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/luna/questions", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = (await res.json()) as { question?: PendingQuestion | null };
      setPendingQuestion(data.question ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!authed || !pathname?.startsWith("/luna")) return;
    void loadPendingQuestion();
  }, [authed, pathname, loadPendingQuestion]);

  useEffect(() => {
    if (!pendingQuestion || teaserDismissed) {
      setTeaserReady(false);
      return;
    }
    const t = window.setTimeout(() => setTeaserReady(true), 3000);
    return () => window.clearTimeout(t);
  }, [pendingQuestion, teaserDismissed]);

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
      if (fabWrapRef.current?.contains(t)) return;
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
    setQuestionFreeText(false);
    setQuestionAnswerDraft("");
    setAnsweredContent(null);
    setAnsweredMessage(null);
  };

  const openPanel = (preferQuestion: boolean) => {
    setError(null);
    if (preferQuestion && pendingQuestion) {
      setPhase("question");
      setQuestionFreeText(false);
      setQuestionAnswerDraft("");
      setAnsweredContent(null);
      setAnsweredMessage(null);
    } else if (
      phase === "done" ||
      phase === "question" ||
      phase === "question_answered"
    ) {
      resetToInput();
    } else if (phase !== "confirm" && phase !== "input") {
      setPhase("input");
    }
    setOpen(true);
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

  const submitQuestionAnswer = async (answer: string) => {
    if (!pendingQuestion || busy) return;
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/questions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question_id: pendingQuestion.id,
          answer
        })
      });
      if (!res.ok) {
        setError((await res.text()) || "답변 저장에 실패했습니다");
        return;
      }
      const data = (await res.json()) as {
        message?: string;
        content?: string;
      };
      setAnsweredMessage(
        data.message?.trim() || "고맙습니다. 이제 이렇게 찾을게요."
      );
      setAnsweredContent(data.content?.trim() || answer);
      setPhase("question_answered");
      setPendingQuestion(null);
      setTeaserDismissed(false);
      setTeaserReady(false);
    } catch (err) {
      console.error("[luna/questions]", err);
      setError("답변 저장에 실패했습니다");
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
    if (open) {
      setOpen(false);
      return;
    }
    openPanel(Boolean(pendingQuestion));
  };

  const onTeaserClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openPanel(true);
  };

  const onTeaserDismiss = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTeaserDismissed(true);
    setTeaserReady(false);
  };

  if (!pathname?.startsWith("/luna")) return null;
  if (!mounted || !authed) return null;

  const hasPending = Boolean(pendingQuestion);
  const showTeaser = hasPending && teaserReady && !teaserDismissed && !open;
  const headerTitle =
    phase === "question" || phase === "question_answered"
      ? "루나"
      : "루나에게 알려주기";

  const ui = (
    <>
      <style>{`
        .luna-learn-bubble::after {
          content: "";
          position: absolute;
          right: 22px;
          bottom: -11px;
          width: 22px;
          height: 22px;
          background: #ffffff;
          border-right: 1px solid #D3D1C7;
          border-bottom: 1px solid #D3D1C7;
          border-bottom-right-radius: 5px;
          transform: rotate(45deg) skew(-6deg, -6deg);
        }
        .luna-question-teaser {
          opacity: 0;
          transform: translateX(8px);
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .luna-question-teaser.is-visible {
          opacity: 1;
          transform: translateX(0);
        }
        .luna-question-teaser::after {
          content: "";
          position: absolute;
          right: -6px;
          bottom: 14px;
          width: 12px;
          height: 12px;
          background: #ffffff;
          border-right: 1px solid #D3D1C7;
          border-bottom: 1px solid #D3D1C7;
          transform: rotate(-45deg);
        }
      `}</style>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={headerTitle}
          className="luna-learn-bubble fixed flex flex-col border border-[#D3D1C7] bg-white"
          style={{
            right: 20,
            bottom: 96,
            zIndex: 70,
            width: 310,
            height: 380,
            display: "flex",
            flexDirection: "column",
            borderRadius: 16,
            boxShadow: "0 8px 28px rgba(0,0,0,0.10)"
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid #E4E2DA",
              flexShrink: 0
            }}
          >
            <div
              className="shrink-0 overflow-hidden"
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                border: "1px solid #E4E2DA"
              }}
              aria-hidden
            >
              <img
                src="/luna/luna-blink.webp"
                alt="루나"
                width={26}
                height={26}
                draggable={false}
                className="block h-full w-full"
                style={{ objectFit: "cover" }}
              />
            </div>
            <p className="min-w-0 flex-1 text-[13px] font-semibold text-slate-900">
              {headerTitle}
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

          <div
            className="min-h-0 flex-1 overflow-y-auto"
            style={{
              padding: "13px 14px",
              display: "flex",
              flexDirection: "column"
            }}
          >
            {error ? (
              <p className="mb-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                {error}
              </p>
            ) : null}

            {phase === "question" && pendingQuestion ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="rounded-[12px_12px_12px_2px] bg-slate-100 px-2.5 py-2 text-[12px] leading-relaxed text-slate-800">
                  {pendingQuestion.question}
                </div>
                {pendingQuestion.context?.trim() ? (
                  <p className="text-[11px] text-gray-500">
                    {pendingQuestion.context}
                  </p>
                ) : null}

                {pendingQuestion.options && pendingQuestion.options.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {pendingQuestion.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={busy}
                        onClick={() => void submitQuestionAnswer(opt)}
                        className="w-full text-left text-slate-800 transition hover:border-[#534AB7] hover:bg-[#EEEDFE] disabled:opacity-50"
                        style={{
                          border: "1px solid #D3D1C7",
                          borderRadius: 9,
                          padding: "8px 11px",
                          fontSize: 12
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : null}

                {pendingQuestion.options &&
                pendingQuestion.options.length > 0 &&
                !questionFreeText ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setQuestionFreeText(true)}
                    className="text-left text-[12px] text-[#534AB7]"
                  >
                    직접 쓸게요
                  </button>
                ) : null}

                {(!pendingQuestion.options ||
                  pendingQuestion.options.length === 0 ||
                  questionFreeText) && (
                  <>
                    <textarea
                      value={questionAnswerDraft}
                      onChange={(e) => setQuestionAnswerDraft(e.target.value)}
                      disabled={busy}
                      placeholder="답변을 적어주세요"
                      className="w-full flex-1 text-slate-800 outline-none focus:border-[#534AB7]"
                      style={{
                        minHeight: 80,
                        border: "1px solid #D3D1C7",
                        borderRadius: 9,
                        padding: "10px 11px",
                        fontSize: 12,
                        resize: "none"
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !questionAnswerDraft.trim()}
                      onClick={() =>
                        void submitQuestionAnswer(questionAnswerDraft.trim())
                      }
                      className="w-full font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
                      style={{
                        padding: 10,
                        borderRadius: 9,
                        fontSize: 13,
                        background: "#534AB7"
                      }}
                    >
                      {busy ? "저장 중…" : "답변하기"}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                  className="mt-auto pt-2 text-center text-[12px] text-gray-500"
                >
                  나중에
                </button>
              </div>
            ) : null}

            {phase === "question_answered" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="rounded-lg bg-[#E1F5EE] px-2.5 py-2 text-[12px] text-[#04342C]">
                  {answeredMessage || "고맙습니다. 이제 이렇게 찾을게요."}
                </div>
                {answeredContent ? (
                  <div className="border-l-2 border-[#534AB7] pl-2 text-[11.5px] leading-relaxed text-slate-800">
                    {answeredContent}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => resetToInput()}
                  className="mt-auto text-center text-[12px] text-[#534AB7]"
                >
                  알려주실 게 더 있으세요?
                </button>
              </div>
            ) : null}

            {phase === "input" ? (
              <div
                className="flex min-h-0 flex-1 flex-col"
                style={{ display: "flex", flexDirection: "column", flex: 1 }}
              >
                <p
                  className="leading-relaxed text-slate-600"
                  style={{
                    background: "#F5F3EE",
                    borderRadius: 9,
                    padding: "10px 11px",
                    fontSize: 12,
                    marginBottom: 11
                  }}
                >
                  아폴론에 대해 알아두면 좋을 것을 알려주세요. 용어, 판단 기준,
                  일하는 방식 무엇이든 좋아요.
                </p>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  placeholder="예: 제안서 표지는 항상 다크 톤을 써요"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSendInput();
                    }
                  }}
                  className="w-full text-slate-800 outline-none focus:border-[#534AB7]"
                  style={{
                    flex: 1,
                    minHeight: 96,
                    border: "1px solid #D3D1C7",
                    borderRadius: 9,
                    padding: "10px 11px",
                    fontSize: 12,
                    resize: "none"
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !text.trim()}
                  onClick={onSendInput}
                  className="w-full font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
                  style={{
                    marginTop: 11,
                    padding: 10,
                    borderRadius: 9,
                    fontSize: 13,
                    background: "#534AB7"
                  }}
                >
                  {busy ? "정리 중…" : "알려주기"}
                </button>
                <p
                  className="text-gray-500"
                  style={{
                    marginTop: 8,
                    fontSize: 10.5,
                    textAlign: "center"
                  }}
                >
                  Enter 로 보내기 · Shift+Enter 줄바꿈
                </p>
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

      <div
        ref={fabWrapRef}
        className="fixed"
        style={{
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          zIndex: 70
        }}
      >
        {hasPending && !teaserDismissed ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onTeaserClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTeaserClick(e as unknown as MouseEvent);
              }
            }}
            className={`luna-question-teaser ${showTeaser ? "is-visible" : ""}`}
            style={{
              position: "absolute",
              right: 66,
              bottom: 14,
              maxWidth: 200,
              background: "#FFFFFF",
              border: "1px solid #D3D1C7",
              borderRadius: 14,
              padding: "8px 12px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "#1C1C1A",
              boxShadow: "0 3px 12px rgba(0,0,0,.10)",
              cursor: "pointer",
              pointerEvents: showTeaser ? "auto" : "none",
              visibility: showTeaser ? "visible" : "hidden"
            }}
          >
            <button
              type="button"
              aria-label="말풍선 닫기"
              onClick={onTeaserDismiss}
              className="absolute text-gray-400"
              style={{
                top: 4,
                right: 6,
                fontSize: 10,
                lineHeight: 1,
                padding: 2
              }}
            >
              ×
            </button>
            <p
              className="pr-3"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden"
              }}
            >
              {pendingQuestion ? teaserText(pendingQuestion) : ""}
            </p>
          </div>
        ) : null}

        <button
          id={fabId}
          type="button"
          title="루나에게 알려주기"
          aria-label="루나에게 알려주기"
          aria-expanded={open}
          onClick={toggleOpen}
          className="relative overflow-hidden rounded-full transition-transform duration-150 hover:scale-[1.06]"
          style={{
            width: 56,
            height: 56,
            border: "1px solid #E4E2DA",
            boxShadow: "0 3px 12px rgba(0,0,0,0.14)"
          }}
        >
          <img
            src="/luna/luna-blink.webp"
            alt="루나"
            width={56}
            height={56}
            draggable={false}
            className="block h-full w-full object-cover"
          />
          {hasPending ? (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#BA7517",
                border: "2px solid white"
              }}
            />
          ) : null}
        </button>
      </div>
    </>
  );

  return createPortal(ui, document.body);
}
