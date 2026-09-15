"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";

type RunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  agenda: string;
  why: string;
  expected: string;
  kind: string;
  outcome: "improved" | "no_change" | "failed" | null;
  result: Record<string, unknown>;
  cost_usd: number;
  llm_calls: number;
};

function outcomeLabel(o: RunRow["outcome"]): string {
  if (o === "improved") return "나아짐";
  if (o === "no_change") return "변화 없음";
  if (o === "failed") return "실패";
  return "미완";
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function LunaStudyRunHistory() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const json = await adminFetch<{ rows: RunRow[] }>("/api/luna-admin/study-runs");
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function feedback(runId: string, verdict: "good" | "why" | "bad") {
    setBusy(runId + verdict);
    try {
      await adminFetch("/api/luna-admin/study-runs", {
        method: "POST",
        body: JSON.stringify({ runId, verdict })
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "피드백 실패");
    } finally {
      setBusy(null);
    }
  }

  if (error && rows.length === 0) return <p className="empty">{error}</p>;
  if (!rows.length && !error) return <p className="empty">불러오는 중…</p>;
  if (rows.length === 0) return <p className="empty">아직 자율 자습 이력이 없습니다.</p>;

  return (
    <>
      <div className="sech">
        <span className="t">자습 실행 이력</span>
        <span className="n">언제 · 무엇을 · 왜 · 결과</span>
      </div>
      {error ? <p className="empty">{error}</p> : null}
      {rows.map((r) => (
        <div className="row" key={r.id}>
          <span className="ic p">🌙</span>
          <div className="c">
            <div className="t">{r.agenda}</div>
            <div className="d">왜 — {r.why}</div>
            <div className="m">
              {dayLabel(r.started_at)} · {outcomeLabel(r.outcome)}
              {typeof r.result.learned === "string" ? ` · ${r.result.learned}` : ""}
              {typeof r.result.miss === "number"
                ? ` · 못 찾음 ${r.result.miss}/${r.result.probed ?? "?"}`
                : ""}
              {` · $${r.cost_usd.toFixed(4)} · LLM ${r.llm_calls}`}
            </div>
            <div className="btns">
              <button
                type="button"
                className="btn sm p"
                disabled={busy !== null}
                onClick={() => void feedback(r.id, "good")}
              >
                잘했다
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy !== null}
                onClick={() => void feedback(r.id, "why")}
              >
                그건 왜 했니
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy !== null}
                onClick={() => void feedback(r.id, "bad")}
              >
                별로
              </button>
            </div>
          </div>
          <span className="rt">{r.kind}</span>
        </div>
      ))}
    </>
  );
}
