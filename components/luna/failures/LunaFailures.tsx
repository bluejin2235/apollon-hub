"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  ErrorLine,
  Hint,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { formatKoreanDay, K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";

type FailureDbFix = {
  id: string;
  kind: "wiki" | "term" | "knowledge";
  title: string;
  details: string[];
  checked: boolean;
};

type FailureRow = {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  question: string;
  answer_excerpt: string;
  signal: string;
  signals?: string[];
  kind: "human" | "self" | "auto";
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  human_note?: string | null;
  asked_by_name?: string | null;
  created_at: string;
  improve_note?: string | null;
  db_fixes?: FailureDbFix[] | null;
  dev_prompt?: string | null;
  db_done_at?: string | null;
  dev_done_at?: string | null;
  dev_fixed_at?: string | null;
  verdict?: "improve" | "skip" | null;
  duration_ms?: number | null;
};

type ThreadBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  duration_ms: number | null;
  wiki: number;
  memory: number;
  web: number;
  notion: number;
  intent: number | null;
  confidence: number | null;
};

type ThreadTurn = {
  user: ThreadBubble | null;
  assistant: ThreadBubble | null;
};

type ThreadPayload = {
  before: ThreadTurn[];
  focus: ThreadTurn | null;
  after: ThreadTurn[];
};

type Cluster = {
  key: string;
  label: string;
  count: number;
  asker_count: number;
};

type PromptGroup = {
  key: string;
  count: number;
  title: string;
  prompts: Array<{ id: string; question: string; prompt: string }>;
};

type Payload = {
  summary: { open: number; improve: number; skip: number };
  kind_summary: {
    all: number;
    human: number;
    self: number;
    auto: number;
    inspect: number;
  };
  clusters: Cluster[];
  dev_groups: PromptGroup[];
  items: FailureRow[];
};

const SIGNAL_LABEL: Record<string, string> = {
  thumbs_down: "👎",
  correction: "정정",
  candidate_deleted: "후보 삭제",
  low_intent: "의도 낮음",
  low_confidence: "자신감 낮음",
  not_found: "못 찾음",
  unclassified: "미분류",
  zero_search: "검색 0건",
  eval_fail: "점검 실패"
};

const KIND_TAB = [
  { key: "all", label: "전체" },
  { key: "human", label: "👎 사람이 표시" },
  { key: "self", label: "🌙 루나가 낮게 평가" },
  { key: "auto", label: "⚙ 자동 감지" },
  { key: "inspect", label: "📋 정기 점검" }
] as const;

const HOT = "#C0392B";
const HOT_BG = "#FDECEA";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = formatKoreanDay(iso);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return day ? `${day} ${hm}` : hm;
}

function formatHm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return `${(ms / 1000).toFixed(1)}초`;
}

function kindTag(item: FailureRow): { label: string; className: string } {
  const signals =
    Array.isArray(item.signals) && item.signals.length > 0
      ? item.signals
      : [item.signal];
  if (item.signal === "eval_fail" || signals.includes("eval_fail")) {
    return {
      label: "📋 정기 점검",
      className: "bg-[#EEF2F7] text-[#4A5568]"
    };
  }
  if (item.kind === "human") {
    return { label: "👎 사람이 표시", className: "bg-[#FDECEA] text-[#C0392B]" };
  }
  if (item.kind === "self") {
    return { label: "🌙 루나가 낮게 평가", className: "bg-[#FBF3E4] text-[#B0782B]" };
  }
  const extras = signals
    .map((s) => SIGNAL_LABEL[s])
    .filter((v) => v && v !== "👎");
  const extra = extras.length ? ` · ${extras.join(" · ")}` : "";
  return { label: `⚙ 자동 감지${extra}`, className: "bg-[#f1f2f5] text-[#6b6f76]" };
}

function humanReason(item: FailureRow): string | null {
  const n = item.human_note?.trim();
  return n || null;
}

function selfReason(item: FailureRow): string | null {
  const n = item.self_note?.trim();
  return n || null;
}

function kindBadgeLabel(kind: FailureDbFix["kind"]): string {
  if (kind === "wiki") return "위키";
  if (kind === "term") return "용어";
  return "지식";
}

function statusText(item: FailureRow): { db: string; dev: string } {
  const db = item.db_done_at
    ? "✓ 지식후보로 보냈습니다"
    : "DB 수정 항목이 아직 완료되지 않았습니다";
  const dev = item.dev_done_at
    ? item.dev_fixed_at
      ? "⚙ 개발 과제를 고쳤습니다"
      : "⚙ 개발 과제로 남겼습니다 · 아직 안 고침"
    : "개발 과제가 아직 완료되지 않았습니다";
  return { db, dev };
}

function WhyBox({ item }: { item: FailureRow }) {
  const human = humanReason(item);
  const self = selfReason(item);
  if (!human && !self) {
    return (
      <div
        className="mb-2 rounded-lg px-3 py-2 text-[12.5px]"
        style={{ background: "#FBFBFC", color: K.faint }}
      >
        사유 없음
      </div>
    );
  }
  return (
    <div className="mb-2 space-y-1.5">
      {human ? (
        <div
          className="rounded-lg px-3 py-2 text-[12.5px] leading-relaxed"
          style={{ background: HOT_BG, color: "#2a2c31" }}
        >
          <span className="mr-1 text-[10px] font-bold" style={{ color: HOT }}>
            왜 아쉬웠나
          </span>
          {human}
        </div>
      ) : null}
      {self ? (
        <div
          className="rounded-lg px-3 py-2 text-[12.5px] leading-relaxed"
          style={{ background: "#FBFBFC", color: "#2a2c31" }}
        >
          <span className="mr-1 text-[10px]" style={{ color: K.sub }}>
            🌙
          </span>
          {self}
        </div>
      ) : null}
    </div>
  );
}

function ImprovePanel({
  item,
  note,
  setNote,
  busy,
  dbFixes,
  setDbFixes,
  devPrompt,
  onSend,
  onDbComplete,
  onDevComplete,
  onDevFixed,
  onCancel
}: {
  item: FailureRow;
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  dbFixes: FailureDbFix[];
  setDbFixes: (next: FailureDbFix[]) => void;
  devPrompt: string;
  onSend: () => void;
  onDbComplete: () => void;
  onDevComplete: () => void;
  onDevFixed: () => void;
  onCancel?: () => void;
}) {
  const done = statusText(item);
  const allChecked = dbFixes.length > 0 && dbFixes.every((f) => f.checked);
  return (
    <div className="mt-2.5 space-y-3 rounded-[11px] border p-3.5" style={{ borderColor: K.luna, background: "#FCFBFF" }}>
      <p className="text-[12px] font-bold" style={{ color: K.lunaInk }}>
        이렇게 했어야 해요
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        className="w-full rounded-[9px] border px-3 py-2.5 text-[12.5px] leading-relaxed"
        style={{ borderColor: K.line, color: "#2a2c31" }}
        placeholder="새 사실·위키 누락·답변 방식·개발 필요 — 섞어 적어도 됩니다. 루나가 나눠 드립니다."
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={onSend}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ background: K.luna }}
        >
          보내기
        </button>
        {onCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border px-3 py-1.5 text-[12px]"
            style={{ borderColor: K.line, color: "#33363c" }}
          >
            취소
          </button>
        ) : null}
      </div>

      {dbFixes.length > 0 ? (
        <div className="rounded-lg border border-[#cfe9dc] bg-white">
          <div className="flex items-center gap-2 border-b border-[#e7e8ec] bg-[#eef8f2] px-3 py-2">
            <strong className="text-[12px] text-[#0f6e56]">📗 DB 수정</strong>
            <span className="text-[11px] text-[#5a766c]">{dbFixes.length}건</span>
          </div>
          <div className="space-y-2 p-3">
            {dbFixes.map((fix) => (
              <label key={fix.id} className="block rounded border border-[#eef0f3] p-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={fix.checked}
                    onChange={(e) =>
                      setDbFixes(
                        dbFixes.map((f) => (f.id === fix.id ? { ...f, checked: e.target.checked } : f))
                      )
                    }
                  />
                  <div>
                    <p className="text-[12px] font-semibold">
                      <span className="mr-1 rounded bg-[#e6f5ef] px-1.5 py-0.5 text-[10px] text-[#0f6e56]">
                        {kindBadgeLabel(fix.kind)}
                      </span>
                      {fix.title}
                    </p>
                    {fix.details.length > 0 ? (
                      <ul className="mt-1 text-[11px] text-[#6b6f76]">
                        {fix.details.map((d, i) => (
                          <li key={`${fix.id}-${i}`}>· {d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </label>
            ))}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-[#7b8088]">
                기본은 전체 체크입니다{allChecked ? "" : " · 일부 해제됨"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={onDbComplete}
                className="rounded bg-[#0f6e56] px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {devPrompt ? (
        <div className="rounded-lg border border-[#2e6fa8] bg-white">
          <div className="flex items-center gap-2 border-b border-[#e7e8ec] bg-[#e9f1f9] px-3 py-2">
            <strong className="text-[12px] text-[#2e6fa8]">⚙ Cursor Agent 프롬프트</strong>
            <span className="ml-auto">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(devPrompt)}
                className="rounded bg-[#2e6fa8] px-2 py-1 text-[10px] text-white"
              >
                복사하기
              </button>
            </span>
          </div>
          <pre className="max-h-[240px] overflow-auto bg-[#1e1e28] p-3 text-[11px] leading-[1.65] text-[#e4e2ee]">
            {devPrompt}
          </pre>
          <div className="flex justify-end gap-2 border-t border-[#e7e8ec] bg-[#fafbfc] px-3 py-2">
            <button
              type="button"
              disabled={busy}
              onClick={onDevComplete}
              className="rounded bg-[#2e6fa8] px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              완료
            </button>
            {item.dev_done_at && !item.dev_fixed_at ? (
              <button
                type="button"
                disabled={busy}
                onClick={onDevFixed}
                className="rounded border border-[#2e6fa8] bg-white px-3 py-1.5 text-[12px] text-[#2e6fa8]"
              >
                실제 고침 표시
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {item.db_done_at || item.dev_done_at ? (
        <div className="space-y-1 rounded border border-[#e7e8ec] bg-white p-2 text-[11px]">
          <p style={{ color: item.db_done_at ? "#0f6e56" : K.sub }}>{done.db}</p>
          <p style={{ color: item.dev_done_at ? "#2e6fa8" : K.sub }}>{done.dev}</p>
          {item.db_done_at ? (
            <a href={buildLunaSettingsUrl("candidates", "pending")} className="text-[#0f6e56] underline">
              지식후보 보기 ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CtxLine({ label }: { label: string }) {
  return (
    <div className="relative my-3.5 text-center text-[10.5px]" style={{ color: K.faint }}>
      <span className="absolute inset-x-0 top-1/2 h-px" style={{ background: K.line2 }} />
      <span className="relative bg-white px-2.5">{label}</span>
    </div>
  );
}

function TurnView({
  turn,
  focus
}: {
  turn: ThreadTurn;
  focus?: boolean;
}) {
  return (
    <div className="mb-3.5 space-y-3">
      {turn.user ? (
        <div className="flex justify-end">
          <div className="max-w-[82%]">
            <div
              className="rounded-[14px] rounded-br px-3.5 py-2.5 text-[12.5px] leading-[1.8] text-white"
              style={{ background: K.luna }}
            >
              {turn.user.content}
            </div>
            <div className="mt-1 text-right text-[10px]" style={{ color: K.faint }}>
              {formatHm(turn.user.created_at)}
            </div>
          </div>
        </div>
      ) : null}
      {turn.assistant ? (
        <div>
          {focus ? (
            <div className="mb-1 text-[10px] font-bold" style={{ color: HOT }}>
              👎 이 답변에 표시했습니다
            </div>
          ) : null}
          <div
            className="max-w-[82%] rounded-[14px] rounded-tl px-3.5 py-2.5 text-[12.5px] leading-[1.8]"
            style={{
              background: "#F7F6FC",
              border: focus ? `2px solid ${HOT}` : "1px solid #E8E5F4",
              color: K.ink
            }}
          >
            {turn.assistant.content}
          </div>
          {focus ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span
                className="rounded-lg px-1.5 py-0.5 text-[10px]"
                style={{
                  background: K.chip,
                  color: turn.assistant.wiki === 0 ? HOT : K.faint
                }}
              >
                위키 {turn.assistant.wiki}건
              </span>
              <span className="rounded-lg px-1.5 py-0.5 text-[10px]" style={{ background: K.chip, color: K.faint }}>
                기억 {turn.assistant.memory}건
              </span>
              {turn.assistant.web > 0 ? (
                <span className="rounded-lg px-1.5 py-0.5 text-[10px]" style={{ background: K.chip, color: K.faint }}>
                  웹 {turn.assistant.web}건
                </span>
              ) : null}
              {turn.assistant.notion > 0 ? (
                <span className="rounded-lg px-1.5 py-0.5 text-[10px]" style={{ background: K.chip, color: K.faint }}>
                  노션 {turn.assistant.notion}건
                </span>
              ) : null}
              {turn.assistant.intent != null || turn.assistant.confidence != null ? (
                <span className="rounded-lg px-1.5 py-0.5 text-[10px]" style={{ background: K.chip, color: K.faint }}>
                  {turn.assistant.intent != null ? `의도 ${turn.assistant.intent}` : ""}
                  {turn.assistant.intent != null && turn.assistant.confidence != null ? " · " : ""}
                  {turn.assistant.confidence != null ? `자신감 ${turn.assistant.confidence}` : ""}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1 text-[10px]" style={{ color: K.faint }}>
            {formatHm(turn.assistant.created_at)}
            {turn.assistant.duration_ms != null
              ? ` · ${formatDurationMs(turn.assistant.duration_ms)}`
              : ""}
            {!focus && (turn.assistant.wiki > 0 || turn.assistant.memory > 0)
              ? ` · 위키 ${turn.assistant.wiki}건 · 기억 ${turn.assistant.memory}건`
              : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useFailureActions(item: FailureRow, onDone: () => void) {
  const [note, setNote] = useState(item.improve_note ?? "");
  const [busy, setBusy] = useState(false);
  const [dbFixes, setDbFixes] = useState<FailureDbFix[]>(item.db_fixes ?? []);
  const [devPrompt, setDevPrompt] = useState(item.dev_prompt ?? "");

  const act = async (action: "improve_send" | "db_complete" | "dev_complete" | "dev_fixed" | "skip") => {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    const body: Record<string, unknown> = { id: item.id, action };
    if (action === "improve_send") body.note = note;
    if (action === "db_complete") {
      body.selected_ids = dbFixes.filter((f) => f.checked).map((f) => f.id);
    }
    const res = await fetch("/api/luna/failures", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const json = res.ok
      ? ((await res.json()) as { db_fixes?: FailureDbFix[]; dev_prompt?: string })
      : null;
    setBusy(false);
    if (!res.ok) return;
    if (action === "improve_send" && json) {
      setDbFixes(json.db_fixes ?? []);
      setDevPrompt(json.dev_prompt ?? "");
      return;
    }
    onDone();
  };

  return { note, setNote, busy, dbFixes, setDbFixes, devPrompt, act };
}

function FailureCard({
  item,
  onDone,
  onOpenThread
}: {
  item: FailureRow;
  onDone: () => void;
  onOpenThread: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { note, setNote, busy, dbFixes, setDbFixes, devPrompt, act } = useFailureActions(item, onDone);
  const tag = kindTag(item);
  const lowIntent = typeof item.intent_score === "number" && item.intent_score < 6;
  const lowConf = typeof item.confidence_score === "number" && item.confidence_score < 6;

  return (
    <div
      className="mb-2 cursor-pointer rounded-[12px] border px-[15px] py-[13px] transition-colors hover:border-[#D9D4EE] hover:bg-[#FBFAFF]"
      style={{ borderColor: K.line, background: K.panel }}
      onClick={onOpenThread}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${tag.className}`}>
          {tag.label}
        </span>
        <span className="text-[10.5px]" style={{ color: K.faint }}>
          {item.asked_by_name ?? "—"}
        </span>
        {item.intent_score != null || item.confidence_score != null ? (
          <span className="text-[10px]" style={{ color: K.faint }}>
            {item.intent_score != null ? (
              <>
                의도{" "}
                <b style={{ color: lowIntent ? "#B0782B" : K.faint }}>{item.intent_score}</b>
              </>
            ) : null}
            {item.intent_score != null && item.confidence_score != null ? " · " : ""}
            {item.confidence_score != null ? (
              <>
                자신감{" "}
                <b style={{ color: lowConf ? "#B0782B" : K.faint }}>{item.confidence_score}</b>
              </>
            ) : null}
          </span>
        ) : null}
        <span className="ml-auto text-[10.5px]" style={{ color: K.faint }}>
          {formatWhen(item.created_at)}
        </span>
      </div>
      <p className="mb-1.5 text-[14.5px] font-semibold leading-normal" style={{ color: K.ink }}>
        {item.question || "(질문 없음)"}
      </p>
      <WhyBox item={item} />
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white"
            style={{ background: K.luna }}
          >
            개선하기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("skip")}
            className="rounded-lg border px-3 py-1.5 text-[11.5px]"
            style={{ borderColor: K.line, color: K.faint }}
          >
            스킵하기
          </button>
        </div>
        <span className="ml-auto text-[10.5px]" style={{ color: K.faint }}>
          눌러서 대화 보기
        </span>
      </div>
      {open ? (
        <div onClick={(e) => e.stopPropagation()}>
          <ImprovePanel
            item={item}
            note={note}
            setNote={setNote}
            busy={busy}
            dbFixes={dbFixes}
            setDbFixes={setDbFixes}
            devPrompt={devPrompt}
            onSend={() => void act("improve_send")}
            onDbComplete={() => void act("db_complete")}
            onDevComplete={() => void act("dev_complete")}
            onDevFixed={() => void act("dev_fixed")}
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function ThreadModal({
  item,
  onClose,
  onDone
}: {
  item: FailureRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [improving, setImproving] = useState(false);
  const { note, setNote, busy, dbFixes, setDbFixes, devPrompt, act } = useFailureActions(
    item,
    () => {
      onDone();
      onClose();
    }
  );
  const tag = kindTag(item);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    setLoading(true);
    const res = await fetch(`/api/luna/failures/thread?id=${encodeURIComponent(item.id)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`대화를 불러오지 못했습니다`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as { thread: ThreadPayload };
    setThread(json.thread);
    setLoading(false);
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openFull = () => {
    if (!item.conversation_id) return;
    window.open(`/luna?c=${item.conversation_id}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,20,28,0.42)] p-5"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,720px)] w-full max-w-[620px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_16px_48px_rgba(0,0,0,.24)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-[17px] py-3" style={{ borderColor: K.line }}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-bold">{item.question || "(질문 없음)"}</div>
            <div className="text-[10.5px]" style={{ color: K.faint }}>
              {formatWhen(item.created_at)}
              {item.asked_by_name ? ` · ${item.asked_by_name}` : ""} · {tag.label}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[16px] leading-none" style={{ color: K.faint }}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          {loading ? <p className="text-[12px]" style={{ color: K.faint }}>대화를 불러오는 중…</p> : null}
          {error ? <p className="text-[12px]" style={{ color: HOT }}>{error}</p> : null}
          {!loading && thread ? (
            <>
              {thread.before.length > 0 ? (
                <>
                  <CtxLine label="앞선 대화" />
                  {thread.before.map((t, i) => (
                    <TurnView key={`b-${t.user?.id ?? t.assistant?.id ?? i}`} turn={t} />
                  ))}
                </>
              ) : null}

              <CtxLine label="여기서 아쉬웠다" />
              {thread.focus ? <TurnView turn={thread.focus} focus /> : null}
              <WhyBox item={item} />

              {thread.after.length > 0 ? (
                <>
                  <CtxLine label="이후 대화" />
                  {thread.after.map((t, i) => (
                    <TurnView key={`a-${t.user?.id ?? t.assistant?.id ?? i}`} turn={t} />
                  ))}
                </>
              ) : null}

              {improving ? (
                <ImprovePanel
                  item={item}
                  note={note}
                  setNote={setNote}
                  busy={busy}
                  dbFixes={dbFixes}
                  setDbFixes={setDbFixes}
                  devPrompt={devPrompt}
                  onSend={() => void act("improve_send")}
                  onDbComplete={() => void act("db_complete")}
                  onDevComplete={() => void act("dev_complete")}
                  onDevFixed={() => void act("dev_fixed")}
                  onCancel={() => setImproving(false)}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5 border-t px-[17px] py-3"
          style={{ borderColor: K.line, background: "#FBFBFC" }}
        >
          {!improving ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setImproving(true)}
                className="rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-white"
                style={{ background: K.luna }}
              >
                개선하기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("skip")}
                className="rounded-lg border px-3 py-1.5 text-[11.5px]"
                style={{ borderColor: K.line, color: K.faint }}
              >
                스킵하기
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border px-3 py-1.5 text-[11.5px]"
                style={{ borderColor: K.line, color: "#33363c" }}
              >
                닫기
              </button>
            </>
          ) : (
            <span className="text-[10.5px]" style={{ color: K.faint }}>
              보내면 DB 수정과 Cursor 프롬프트로 나눠 드립니다
            </span>
          )}
          {item.conversation_id ? (
            <button
              type="button"
              onClick={openFull}
              className="ml-auto text-[10.5px]"
              style={{ color: K.faint }}
            >
              전체 대화 열기 ↗
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LunaFailures() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [kind, setKind] = useState<"all" | "human" | "self" | "auto" | "inspect">(
    "all"
  );
  const [status, setStatus] = useState<"open" | "improve" | "skip">("open");
  const [openItem, setOpenItem] = useState<FailureRow | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch(`/api/luna/failures?kind=${kind}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(
        res.status === 403
          ? "슈퍼관리자만 볼 수 있습니다."
          : `불러오기 실패: ${await res.text()}`
      );
      setLoading(false);
      return;
    }
    setData((await res.json()) as Payload);
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (status === "open") return data.items.filter((r) => !r.verdict);
    return data.items.filter((r) => r.verdict === status);
  }, [data, status]);

  return (
    <KnowledgeShell>
      <p className="mb-3 text-[13px]" style={{ color: K.sub }}>
        잘 안 된 순간만 모읍니다. 카드를 누르면 그때 대화를 볼 수 있어요.
      </p>

      {data ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {KIND_TAB.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`rounded-[10px] border px-3.5 py-2 text-[12.5px] ${
                  kind === k.key
                    ? "border-[#534AB7] bg-[#534AB7] text-white font-bold"
                    : "border-[#e7e8ec] bg-white text-[#6b6f76]"
                }`}
              >
                {k.label}{" "}
                <span className="opacity-80">
                  {k.key === "all"
                    ? data.kind_summary.all
                    : k.key === "human"
                      ? data.kind_summary.human
                      : k.key === "self"
                        ? data.kind_summary.self
                        : k.key === "inspect"
                          ? data.kind_summary.inspect
                          : data.kind_summary.auto}
                </span>
              </button>
            ))}
          </div>

          <div
            className="mb-3.5 flex flex-wrap gap-3.5 border-b pb-2.5 text-[11.5px]"
            style={{ borderColor: K.line2, color: K.sub }}
          >
            <button type="button" onClick={() => setStatus("open")} className={status === "open" ? "font-bold text-[#3C3489]" : ""}>
              확인할 것 <b style={{ color: K.ink }}>{data.summary.open}</b>
            </button>
            <button type="button" onClick={() => setStatus("improve")} className={status === "improve" ? "font-bold text-[#3C3489]" : ""}>
              개선한 것 <b style={{ color: K.ink }}>{data.summary.improve}</b>
            </button>
            <button type="button" onClick={() => setStatus("skip")} className={status === "skip" ? "font-bold text-[#3C3489]" : ""}>
              스킵한 것 <b style={{ color: K.ink }}>{data.summary.skip}</b>
            </button>
          </div>
        </>
      ) : null}

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && !error && data ? (
        <>
          {status === "open" && data.clusters.length > 0 ? (
            <div className="mb-4 space-y-2">
              <p className="text-[12px] font-semibold" style={{ color: K.sub }}>
                묶어 보기
              </p>
              {data.clusters.slice(0, 8).map((c) => (
                <div
                  key={c.key}
                  className="rounded-lg border border-[#e7e8ec] bg-[#fafbfc] px-3 py-2 text-[13px]"
                  style={{ color: K.ink }}
                >
                  「{c.label}…」 관련 {c.count}번 · {c.asker_count}명
                </div>
              ))}
            </div>
          ) : null}

          {status === "improve" && data.dev_groups.length > 0 ? (
            <div className="mb-4 space-y-2">
              {data.dev_groups.map((g) => (
                <div key={g.key} className="rounded-lg border border-[#e7e8ec] bg-white p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge kind="src">개발 필요</Badge>
                    <strong className="text-[13px]">{g.title}</strong>
                    <span className="text-[11px] text-[#9aa0a8]">{g.count}건</span>
                    <span className="ml-auto">
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            g.prompts.map((p) => `### ${p.question}\n${p.prompt}`).join("\n\n")
                          )
                        }
                        className="rounded bg-[#2e6fa8] px-2 py-1 text-[10px] text-white"
                      >
                        프롬프트 합쳐서 복사
                      </button>
                    </span>
                  </div>
                  {g.prompts.slice(0, 5).map((p) => (
                    <p key={p.id} className="text-[12px] text-[#6b6f76]">
                      · {p.question}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <p className="text-[13px]" style={{ color: K.faint }}>
              항목이 없습니다.
            </p>
          ) : (
            filtered.map((item) => (
              <FailureCard
                key={item.id}
                item={item}
                onDone={load}
                onOpenThread={() => setOpenItem(item)}
              />
            ))
          )}
          <Hint>최근 {filtered.length}건 · 카드를 누르면 그때 대화가 열립니다</Hint>
          <p className="mt-2 text-[11px]" style={{ color: K.faint }}>
            「전체」에는 정기 점검을 넣지 않습니다. 점검 결과는 📋 탭에서 보세요.
            사람 메모와 루나 자기평가는 카드에 구분해 표시합니다.
          </p>
        </>
      ) : null}

      {openItem ? (
        <ThreadModal item={openItem} onClose={() => setOpenItem(null)} onDone={load} />
      ) : null}
    </KnowledgeShell>
  );
}
