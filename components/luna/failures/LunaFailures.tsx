"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  ErrorLine,
  Hint,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
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
  question: string;
  answer_excerpt: string;
  signal: string;
  kind: "human" | "self" | "auto";
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  asked_by_name?: string | null;
  improve_note?: string | null;
  db_fixes?: FailureDbFix[] | null;
  dev_prompt?: string | null;
  db_done_at?: string | null;
  dev_done_at?: string | null;
  dev_fixed_at?: string | null;
  verdict?: "improve" | "skip" | null;
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
  kind_summary: { all: number; human: number; self: number; auto: number };
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
  { key: "auto", label: "⚙ 자동 감지" }
] as const;

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function scoreTone(v: number | null): "src" | "red" {
  if (typeof v !== "number") return "src";
  return v < 5 ? "red" : "src";
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

function FailureCard({
  item,
  onDone
}: {
  item: FailureRow;
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(item.improve_note ?? "");
  const [busy, setBusy] = useState(false);
  const [dbFixes, setDbFixes] = useState<FailureDbFix[]>(item.db_fixes ?? []);
  const [devPrompt, setDevPrompt] = useState(item.dev_prompt ?? "");

  const done = statusText(item);

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
    const json = res.ok ? ((await res.json()) as { db_fixes?: FailureDbFix[]; dev_prompt?: string }) : null;
    setBusy(false);
    if (!res.ok) return;
    if (action === "improve_send" && json) {
      setDbFixes(json.db_fixes ?? []);
      setDevPrompt(json.dev_prompt ?? "");
      return;
    }
    onDone();
  };

  const allChecked = dbFixes.length > 0 && dbFixes.every((f) => f.checked);

  return (
    <ListItem>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="src">{SIGNAL_LABEL[item.signal] ?? item.signal}</Badge>
          <Badge kind="src">{item.kind === "human" ? "사람 표시" : item.kind === "self" ? "루나 낮음" : "자동 감지"}</Badge>
          {item.intent_score != null ? <Badge kind={scoreTone(item.intent_score)}>의도 {item.intent_score}</Badge> : null}
          {item.confidence_score != null ? (
            <Badge kind={scoreTone(item.confidence_score)}>자신감 {item.confidence_score}</Badge>
          ) : null}
          <span className="text-[12px]" style={{ color: K.faint }}>
            {item.asked_by_name ?? "—"}
          </span>
        </div>
        <button
          type="button"
          className="w-full text-left"
          onClick={() => (item.conversation_id ? router.push(`/luna?c=${item.conversation_id}`) : undefined)}
        >
          <p className="text-[13.5px] font-bold leading-[1.45]" style={{ color: K.ink }}>
            {item.question || "(질문 없음)"}
          </p>
          <p className="mt-1 text-[13px] leading-[1.5]" style={{ color: K.sub }}>
            {item.answer_excerpt || "(답변 없음)"}
          </p>
          {item.self_note ? (
            <p className="mt-1 text-[12px] italic" style={{ color: K.faint }}>
              {item.self_note}
            </p>
          ) : null}
        </button>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-[#2563eb] bg-[#eff6ff] px-3 py-1.5 text-[12px] font-semibold text-[#2563eb]"
          >
            개선하기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("skip")}
            className="rounded-lg border border-[#e7e8ec] bg-white px-3 py-1.5 text-[12px] text-[#6b6f76]"
          >
            스킵하기
          </button>
        </div>

        {open ? (
          <div className="space-y-3 rounded-lg border border-[#e7e8ec] bg-[#fafbfc] p-3">
            <p className="mb-2 text-[12px] font-semibold" style={{ color: K.sub }}>
              이렇게 했어야 해요
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-[#e7e8ec] px-2 py-1.5 text-[13px]"
              placeholder="새 사실·위키 누락·답변 방식·개발 필요 — 섞어 적어도 됩니다. 루나가 나눠 드립니다."
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => void act("improve_send")}
                className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                보내기
              </button>
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
                            setDbFixes((prev) =>
                              prev.map((f) => (f.id === fix.id ? { ...f, checked: e.target.checked } : f))
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
                      onClick={() => void act("db_complete")}
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
                    onClick={() => void act("dev_complete")}
                    className="rounded bg-[#2e6fa8] px-3 py-1.5 text-[12px] font-semibold text-white"
                  >
                    완료
                  </button>
                  {item.dev_done_at && !item.dev_fixed_at ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act("dev_fixed")}
                      className="rounded border border-[#2e6fa8] bg-white px-3 py-1.5 text-[12px] text-[#2e6fa8]"
                    >
                      실제 고침 표시
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {(item.db_done_at || item.dev_done_at) ? (
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
        ) : null}
      </div>
    </ListItem>
  );
}

export function LunaFailures() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [kind, setKind] = useState<"all" | "human" | "self" | "auto">("all");
  const [status, setStatus] = useState<"open" | "improve" | "skip">("open");

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
        잘 안 된 순간만 모읍니다. 성공한 답변은 여기 없습니다.
      </p>

      {data ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {KIND_TAB.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] ${
                  kind === k.key
                    ? "border-[#534AB7] bg-[#534AB7] text-white"
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
                        : data.kind_summary.auto}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap gap-3 text-[13px]">
            <button type="button" onClick={() => setStatus("open")} className={status === "open" ? "font-bold text-[#3C3489]" : "text-[#6b6f76]"}>
              확인할 것 {data.summary.open}
            </button>
            <button type="button" onClick={() => setStatus("improve")} className={status === "improve" ? "font-bold text-[#3C3489]" : "text-[#6b6f76]"}>
              개선한 것 {data.summary.improve}
            </button>
            <button type="button" onClick={() => setStatus("skip")} className={status === "skip" ? "font-bold text-[#3C3489]" : "text-[#6b6f76]"}>
              스킵한 것 {data.summary.skip}
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

          <ListCard>
            {filtered.length === 0 ? (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  항목이 없습니다.
                </p>
              </ListItem>
            ) : (
              filtered.map((item) => <FailureCard key={item.id} item={item} onDone={load} />)
            )}
          </ListCard>
          <Hint>최근 {filtered.length}건 · 행을 누르면 그 대화로 갑니다</Hint>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
