"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { ruleQuestionText } from "@/lib/luna/rules-shared";

type RuleRow = {
  id: string;
  scope: string;
  pattern_type: string;
  pattern_value: string;
  signal_count: number;
  status: "candidate" | "active" | "dropped";
  evidence: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
  applied_count?: number;
};

type Payload = {
  rows: RuleRow[];
  counts: { candidate: number; active: number; dropped: number };
};

type Filter = "active" | "candidate" | "dropped";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d);
}

export function LunaSelfstudyLearned() {
  const [filter, setFilter] = useState<Filter>("active");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const json = await adminFetch<Payload>("/api/luna-admin/rules");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(id: string, accept: boolean) {
    setBusy(id);
    try {
      await adminFetch("/api/luna-admin/rules", {
        method: "POST",
        body: JSON.stringify({ id, accept })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const rows = data.rows.filter((r) => r.status === filter);

  return (
    <>
      <div className="sech">
        <span className="t">배운 것</span>
        <span className="n">루나가 무엇으로 판단하는지</span>
      </div>
      <div className="chips subchips">
        {(
          [
            ["active", `활성 규칙 ${data.counts.active}`],
            ["candidate", `후보 ${data.counts.candidate}`],
            ["dropped", `버린 것 ${data.counts.dropped}`]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "on" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty">
          {filter === "active"
            ? "활성 규칙이 없습니다."
            : filter === "candidate"
              ? "확인 대기 후보가 없습니다."
              : "버린 규칙이 없습니다."}
        </p>
      ) : (
        rows.map((row) => (
          <div className="row" key={row.id}>
            <span className={`ic ${row.status === "active" ? "g" : row.status === "candidate" ? "y" : "r"}`}>
              {row.pattern_type === "stopword" ? "어" : "규"}
            </span>
            <div className="c">
              <div className="t">{ruleQuestionText(row)}</div>
              <div className="d">
                {row.scope} · {row.pattern_type} · {row.pattern_value}
              </div>
              <div className="m">
                근거 신호 {row.signal_count}건
                {row.confirmed_at ? ` · 확인 ${formatWhen(row.confirmed_at)}` : ""}
                {!row.confirmed_at ? ` · 후보 ${formatWhen(row.created_at)}` : ""}
              </div>
              {filter === "candidate" ? (
                <div className="btns">
                  <button
                    type="button"
                    className="btn p sm"
                    disabled={busy === row.id}
                    onClick={() => void answer(row.id, true)}
                  >
                    맞아요
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy === row.id}
                    onClick={() => void answer(row.id, false)}
                  >
                    아니요
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))
      )}
      {error ? <p className="empty">{error}</p> : null}
    </>
  );
}
