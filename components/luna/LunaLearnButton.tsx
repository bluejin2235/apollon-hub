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
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type PanelPhase =
  | "menu"
  | "input"
  | "confirm"
  | "done"
  | "question"
  | "question_thanks";

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
  content: string;
  knowledge: string;
  evidence: string | null;
  source_conversation_id: string | null;
  created_at: string | null;
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

function sourceLine(q: PendingQuestion): string {
  if (q.evidence?.trim()) {
    const e = q.evidence.trim();
    return e.length > 72 ? `${e.slice(0, 72)}…` : e;
  }
  return "어제 대화에서 나온 질문이에요";
}

export function LunaLearnButton() {
  const pathname = usePathname();
  const router = useRouter();
  const reactId = useId();
  const fabId = `luna-learn-fab-${reactId.replace(/:/g, "")}`;
  const [mounted, setMounted] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PanelPhase>("menu");
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
  const [candidateCount, setCandidateCount] = useState(0);
  const [userName, setUserName] = useState("님");
  const [questionAnswerDraft, setQuestionAnswerDraft] = useState("");
  const [thanksMessage, setThanksMessage] = useState("고마워요, 배웠어요!");
  const panelRef = useRef<HTMLDivElement>(null);
  const fabWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setIsNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
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
        setPhase("menu");
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

  const loadPending = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch("/api/luna/popup/pending", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        question?: PendingQuestion | null;
        candidate_count?: number;
        user_name?: string;
      };
      setPendingQuestion(data.question ?? null);
      setCandidateCount(
        typeof data.candidate_count === "number" ? data.candidate_count : 0
      );
      if (typeof data.user_name === "string" && data.user_name.trim()) {
        setUserName(data.user_name.trim());
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    void loadPending();
    const t = window.setInterval(() => void loadPending(), 60_000);
    return () => window.clearInterval(t);
  }, [authed, loadPending]);

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

  const resetToInput = () => {
    setPhase("input");
    setText("");
    setRawText("");
    setRevision("");
    setResult(null);
    setError(null);
    setCategory("term");
    setQuestionAnswerDraft("");
  };

  const openMenu = () => {
    setError(null);
    setPhase("menu");
    setOpen(true);
    void loadPending();
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

  const submitPopupRespond = async (
    action: "answer" | "yes" | "no" | "later",
    answerText?: string
  ) => {
    if (!pendingQuestion || busy) return;
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/luna/popup/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: pendingQuestion.id,
          action,
          text: answerText
        })
      });
      if (!res.ok) {
        setError((await res.text()) || "응답 저장에 실패했습니다");
        return;
      }
      const data = (await res.json()) as { message?: string };
      if (action === "later") {
        setPendingQuestion(null);
        setOpen(false);
        setPhase("menu");
        void loadPending();
        return;
      }
      setThanksMessage(data.message?.trim() || "고마워요, 배웠어요!");
      setPendingQuestion(null);
      setPhase("question_thanks");
      void loadPending();
      window.setTimeout(() => {
        setOpen(false);
        setPhase("menu");
      }, 1600);
    } catch (err) {
      console.error("[luna/popup/respond]", err);
      setError("응답 저장에 실패했습니다");
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
      void loadPending();
    }
  };

  const toggleOpen = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    openMenu();
  };

  const openCandidates = () => {
    setOpen(false);
    router.push("/settings?luna=teach");
  };

  const isLogin =
    pathname === "/" ||
    pathname?.startsWith("/login") ||
    pathname?.startsWith("/auth");
  if (isLogin) return null;
  if (!mounted || !authed) return null;

  const hasPending = Boolean(pendingQuestion);
  const headerTitle =
    phase === "menu"
      ? "루나"
      : phase === "question" || phase === "question_thanks"
        ? "루나의 질문"
        : "루나에게 알려주기";
  const fabSize = isNarrow ? 44 : 56;
  const fabRight = isNarrow ? 14 : 20;
  const fabBottom = "calc(var(--bottom-ui, 0px) + 12px)";

  const ui = (
    <>
      <style>{`
        .luna-learn-fab::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .luna-learn-fab { -ms-overflow-style: none; scrollbar-width: none; }
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
      `}</style>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={headerTitle}
          className="luna-learn-bubble fixed flex flex-col border border-[#D3D1C7] bg-white"
          style={{
            right: fabRight,
            bottom: `calc(var(--bottom-ui, 0px) + 12px + ${fabSize}px + 12px)`,
            zIndex: 70,
            width: isNarrow ? "min(310px, calc(100vw - 28px))" : 310,
            height: phase === "menu" ? "auto" : 380,
            maxHeight: "min(380px, calc(100vh - 100px))",
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
                alt=""
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

            {phase === "menu" ? (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={!hasPending}
                  onClick={() => {
                    if (!pendingQuestion) return;
                    setError(null);
                    setQuestionAnswerDraft("");
                    setPhase("question");
                  }}
                  className="flex w-full items-center justify-between rounded-[10px] border border-[#D3D1C7] px-3 py-2.5 text-left text-[13px] text-slate-800 transition hover:border-[#534AB7] hover:bg-[#EEEDFE] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span>루나의 질문 보기</span>
                  {hasPending ? (
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
                      style={{ background: "#E24B4A" }}
                    >
                      1
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    resetToInput();
                    void loadWeekCount();
                  }}
                  className="w-full rounded-[10px] border border-[#D3D1C7] px-3 py-2.5 text-left text-[13px] text-slate-800 transition hover:border-[#534AB7] hover:bg-[#EEEDFE]"
                >
                  루나에게 알려주기
                </button>
                <button
                  type="button"
                  onClick={openCandidates}
                  className="flex w-full items-center justify-between rounded-[10px] border border-[#D3D1C7] px-3 py-2.5 text-left text-[13px] text-slate-800 transition hover:border-[#534AB7] hover:bg-[#EEEDFE]"
                >
                  <span>지식 후보함 열기</span>
                  {candidateCount > 0 ? (
                    <span className="text-[11px] text-slate-500">
                      {candidateCount}건
                    </span>
                  ) : null}
                </button>
              </div>
            ) : null}

            {phase === "question" && pendingQuestion ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <p className="text-[12.5px] font-medium text-slate-900">
                  {userName}님, 하나만 여쭤봐도 돼요?
                </p>
                <div className="rounded-[12px_12px_12px_2px] bg-slate-100 px-2.5 py-2 text-[12px] leading-relaxed text-slate-800">
                  {pendingQuestion.content}
                </div>
                <p className="text-[11px] text-gray-500">
                  {sourceLine(pendingQuestion)}
                </p>

                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitPopupRespond("yes")}
                    className="w-full rounded-[9px] bg-[#534AB7] py-2 text-[12px] font-medium text-white hover:bg-[#3C3489] disabled:opacity-50"
                  >
                    네 맞아요
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitPopupRespond("no")}
                    className="w-full rounded-[9px] border border-[#D3D1C7] py-2 text-[12px] text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    아니에요
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitPopupRespond("later")}
                    className="w-full py-1.5 text-[12px] text-gray-500 disabled:opacity-50"
                  >
                    나중에
                  </button>
                </div>

                <textarea
                  value={questionAnswerDraft}
                  onChange={(e) => setQuestionAnswerDraft(e.target.value)}
                  disabled={busy}
                  placeholder="직접 입력"
                  className="w-full text-slate-800 outline-none focus:border-[#534AB7]"
                  style={{
                    minHeight: 64,
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
                    void submitPopupRespond(
                      "answer",
                      questionAnswerDraft.trim()
                    )
                  }
                  className="w-full rounded-[9px] border border-[#534AB7] py-2 text-[12px] font-medium text-[#534AB7] disabled:opacity-50"
                >
                  {busy ? "저장 중…" : "직접 답하기"}
                </button>
              </div>
            ) : null}

            {phase === "question_thanks" ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="rounded-lg bg-[#E1F5EE] px-3 py-2.5 text-center text-[13px] text-[#04342C]">
                  {thanksMessage}
                </div>
              </div>
            ) : null}

            {phase === "input" ? (
              <div
                className="flex min-h-0 flex-1 flex-col"
                style={{ display: "flex", flexDirection: "column", flex: 1 }}
              >
                <button
                  type="button"
                  onClick={() => setPhase("menu")}
                  className="mb-2 text-left text-[11px] text-[#534AB7]"
                >
                  ← 메뉴
                </button>
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
                        setPhase("menu");
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
                  후보함에 넣었어요. 확정되면 기억에 남아요.
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
                <button
                  type="button"
                  onClick={() => setPhase("menu")}
                  className="w-full py-1 text-[11px] text-gray-500"
                >
                  메뉴로
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
          right: fabRight,
          bottom: fabBottom,
          width: fabSize,
          height: fabSize,
          zIndex: 30,
          overflow: "visible",
          background: "transparent",
          border: "none",
          padding: 0
        }}
      >
        <button
          id={fabId}
          type="button"
          title="루나"
          aria-label={hasPending ? "루나 (질문 1건)" : "루나"}
          aria-expanded={open}
          onClick={toggleOpen}
          className="luna-learn-fab relative rounded-full transition-transform duration-150 hover:scale-[1.06] focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#534AB7] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          style={{
            display: "block",
            width: fabSize,
            height: fabSize,
            maxWidth: fabSize,
            maxHeight: fabSize,
            minWidth: fabSize,
            minHeight: fabSize,
            padding: 0,
            margin: 0,
            border: "1px solid #E4E2DA",
            borderRadius: 9999,
            boxSizing: "border-box",
            overflow: "visible",
            lineHeight: 0,
            appearance: "none",
            WebkitAppearance: "none",
            background: "#fff",
            boxShadow: "0 3px 14px rgba(0,0,0,.16)",
            cursor: "pointer",
            scrollbarWidth: "none",
            msOverflowStyle: "none"
          }}
        >
          <span
            aria-hidden
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: 9999,
              lineHeight: 0,
              pointerEvents: "none"
            }}
          >
            <img
              src="/luna/luna-blink.webp"
              alt=""
              draggable={false}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: 9999,
                border: "none",
                maxWidth: "none"
              }}
            />
          </span>
          {hasPending ? (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 9999,
                background: "#E24B4A",
                border: "2px solid white",
                boxSizing: "border-box",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "14px",
                textAlign: "center",
                overflow: "visible"
              }}
            >
              1
            </span>
          ) : null}
        </button>
      </div>
    </>
  );

  return createPortal(ui, document.body);
}
