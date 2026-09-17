"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import {
  ANSWER_FLAG_IDS,
  ANSWER_FLAG_LABELS,
  type AnswerFlagId
} from "@/lib/luna/answer-flags-shared";
import {
  THUMBS_REASON_IDS,
  THUMBS_REASON_LABELS
} from "@/lib/luna/signals-shared";

type FlagHit = { id: string; label: string; hint: string };
type Metrics = {
  intent_score?: number | null;
  confidence_score?: number | null;
  duration_ms?: number | null;
  search_ms?: number | null;
  total_docs?: number;
  notion_n?: number;
  wiki_n?: number;
  candidates_found?: number | null;
  candidates_used?: number | null;
};

type FlagRow = {
  id: string;
  message_id: string | null;
  question: string;
  flags: FlagHit[];
  severity: number;
  metrics: Metrics;
  status: string;
  human_verdict: string | null;
  source: string;
  created_at: string;
};

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms)}ms`;
}

export function LunaAdminAnswerFlags() {
  const [status, setStatus] = useState<"pending" | "reviewed" | "ignored" | "all">(
    "pending"
  );
  const [flagFilter, setFlagFilter] = useState<AnswerFlagId | "">("");
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [badReason, setBadReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({ status });
      if (flagFilter) qs.set("flag", flagFilter);
      const json = await adminFetch<{ rows: FlagRow[]; pending: number }>(
        `/api/luna-admin/answer-flags?${qs.toString()}`
      );
      setRows(json.rows ?? []);
      setPending(json.pending ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, [status, flagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(
    id: string,
    verdict: "good" | "bad" | "unclear"
  ) {
    setBusy(id);
    try {
      await adminFetch("/api/luna-admin/answer-flags", {
        method: "POST",
        body: JSON.stringify({
          id,
          verdict,
          reason: verdict === "bad" ? badReason[id] || "wrong_answer" : null
        })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <div className="hd">
        <h2>답 점검</h2>
        <p className="mut">
          지표가 어긋난 답만 모았습니다. 답의 옳고 그름은 사람이 봅니다. 대기{" "}
          {pending}건
        </p>
      </div>

      <div className="btns" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        {(
          [
            ["pending", "대기"],
            ["reviewed", "봤음"],
            ["ignored", "무시함"],
            ["all", "전체"]
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={status === v ? "on" : ""}
            onClick={() => setStatus(v)}
          >
            {label}
          </button>
        ))}
        <select
          value={flagFilter}
          onChange={(e) =>
            setFlagFilter((e.target.value as AnswerFlagId | "") || "")
          }
          style={{ marginLeft: 8 }}
        >
          <option value="">걸린 규칙 전체</option>
          {ANSWER_FLAG_IDS.map((id) => (
            <option key={id} value={id}>
              {ANSWER_FLAG_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="empty">{error}</p> : null}
      {rows.length === 0 && !error ? (
        <p className="empty">해당 조건의 항목이 없습니다.</p>
      ) : null}

      <ul className="list">
        {rows.map((row) => {
          const m = row.metrics ?? {};
          return (
            <li key={row.id} className="card" style={{ marginBottom: 12 }}>
              <div className="t">
                “{row.question || "(질문 없음)"}”
                <span className="mut" style={{ marginLeft: 8 }}>
                  심각도 {row.severity} · {row.source}
                </span>
              </div>
              <div className="d" style={{ marginTop: 6 }}>
                문서 {m.total_docs ?? "—"}건
                {m.notion_n != null ? ` (노션 ${m.notion_n}` : ""}
                {m.wiki_n != null ? ` · 위키 ${m.wiki_n})` : m.notion_n != null ? ")" : ""}
                {" · "}
                자신감 {m.confidence_score ?? "—"}
                {m.intent_score != null ? ` · 의도 ${m.intent_score}` : ""}
                {" · "}
                {formatMs(m.duration_ms)}
                {m.search_ms != null ? ` (검색 ${formatMs(m.search_ms)})` : ""}
              </div>
              <div className="d" style={{ marginTop: 4 }}>
                걸린 것 —{" "}
                {row.flags.map((f) => f.label).join(" · ") || "—"}
              </div>
              {row.status === "pending" ? (
                <div className="btns" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                  {row.message_id ? (
                    <a
                      className="btn"
                      href={`/luna?message=${row.message_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      답 보기
                    </a>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, "good")}
                  >
                    맞아요
                  </button>
                  <select
                    value={badReason[row.id] ?? "wrong_answer"}
                    onChange={(e) =>
                      setBadReason((prev) => ({
                        ...prev,
                        [row.id]: e.target.value
                      }))
                    }
                  >
                    {THUMBS_REASON_IDS.map((id) => (
                      <option key={id} value={id}>
                        {THUMBS_REASON_LABELS[id]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, "bad")}
                  >
                    틀려요
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, "unclear")}
                  >
                    무시
                  </button>
                </div>
              ) : (
                <div className="mut" style={{ marginTop: 8 }}>
                  {row.status}
                  {row.human_verdict ? ` · ${row.human_verdict}` : ""}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
