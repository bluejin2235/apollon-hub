"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Filter = "all" | "improved" | "no_change" | "stuck" | "failed";

function outcomeLabel(o: RunRow["outcome"], result: Record<string, unknown>): string {
  if (o === "improved") return "나아짐";
  if (o === "no_change") return "변화 없음";
  if (o === "failed") return "실패";
  if (result.timed_out || result.ask_human) return "막힘";
  return "미완";
}

function outcomeClass(o: RunRow["outcome"], result: Record<string, unknown>): string {
  if (o === "improved") return "g";
  if (o === "failed") return "r";
  if (result.timed_out || result.ask_human) return "y";
  return "gray";
}

function todayKstKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function kstDay(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function rangeLabel(start: string, end: string | null): string {
  const a = new Date(start);
  const b = end ? new Date(end) : a;
  const fmt = (d: Date) =>
    d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  return `${fmt(a)} ~ ${fmt(b)}`;
}

function minutesBetween(start: string, end: string | null): number {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(1, Math.round((b - a) / 60000));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function LunaStudyRunHistory() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const json = await adminFetch<{ rows: RunRow[] }>("/api/luna-admin/study-runs");
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoaded(true);
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

  const lastNightKey = useMemo(() => {
    const today = todayKstKey();
    const hasToday = rows.some((r) => kstDay(r.started_at) === today);
    if (hasToday) return today;
    const y = new Date();
    y.setUTCDate(y.getUTCDate() - 1);
    return todayKstKey(y);
  }, [rows]);

  const lastNight = rows.filter((r) => kstDay(r.started_at) === lastNightKey);
  const tableRows = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "stuck") {
      return Boolean(r.result.timed_out || r.result.ask_human) && r.outcome !== "failed";
    }
    return r.outcome === filter;
  });

  if (error && rows.length === 0 && loaded) return <p className="empty">{error}</p>;
  if (!loaded) return <p className="empty">불러오는 중…</p>;

  const nightMin = lastNight.reduce(
    (s, r) => s + minutesBetween(r.started_at, r.finished_at),
    0
  );
  const nightLlm = lastNight.reduce((s, r) => s + (r.llm_calls || 0), 0);
  const nightCost = lastNight.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const improved = lastNight.some((r) => r.outcome === "improved");
  const blocked = lastNight.some(
    (r) => r.outcome === "failed" || r.result.ask_human || r.result.timed_out
  );

  return (
    <>
      <div className="alert g">
        <div className="c">
          <div className="t">
            어젯밤 {lastNight.length}건
            {nightMin ? ` · ${nightMin}분` : ""}
            {nightLlm ? ` · LLM ${nightLlm}회` : ""}
            {` · $${nightCost.toFixed(2)}`}
          </div>
          <div className="d">
            {lastNight.length === 0
              ? "어젯밤 기록이 없습니다."
              : blocked && improved
                ? "하나는 나아졌고 하나는 막혔습니다. 막힌 것은 사람 손이 필요합니다."
                : blocked
                  ? "막힌 것은 사람 손이 필요합니다."
                  : improved
                    ? "나아진 것이 있습니다."
                    : "변화는 크지 않았습니다."}
          </div>
        </div>
      </div>
      {error ? <p className="empty">{error}</p> : null}

      {lastNight.map((r) => {
        const probed = num(r.result.probed);
        const hit1 = num(r.result.hit_at_1);
        const hit5 = num(r.result.hit_at_5);
        const miss = num(r.result.miss);
        const learned =
          typeof r.result.learned === "string" ? r.result.learned : null;
        const next = typeof r.result.next === "string" ? r.result.next : null;
        const stuck = Boolean(r.result.ask_human || r.result.timed_out);
        const badge = outcomeLabel(r.outcome, r.result);
        return (
          <div className="run" key={r.id}>
            <div className="rh">
              <span className="t">{r.agenda}</span>
              <span className={`tag ${outcomeClass(r.outcome, r.result)}`}>{badge}</span>
              <span className="dt">{rangeLabel(r.started_at, r.finished_at)}</span>
            </div>
            <div className="why">왜 — {r.why}</div>
            <div className="res">
              {probed != null ? (
                <div>
                  문항 <b>{probed}</b>
                </div>
              ) : null}
              {hit1 != null ? (
                <div>
                  1위로 찾음 <b>{hit1}</b>
                </div>
              ) : null}
              {hit5 != null ? (
                <div>
                  5위 안 <b>{hit5}</b>
                </div>
              ) : null}
              {miss != null ? (
                <div>
                  못 찾음 <b>{miss}</b>
                </div>
              ) : null}
              {typeof r.result.pages_sampled === "number" ? (
                <div>
                  문서 <b>{r.result.pages_sampled}</b>
                </div>
              ) : null}
            </div>
            {learned || next || stuck ? (
              <div className={`learn${stuck ? " y" : ""}`}>
                <div className="lt">{stuck ? "막힌 것" : "알아낸 것"}</div>
                {learned}
                {next ? (
                  <>
                    <br />
                    <b>다음</b> — {next}
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="acts">
              <button
                type="button"
                className="btn sm"
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
              <span className="sp" />
              <span className="meta">
                LLM {r.llm_calls}회 · ${r.cost_usd.toFixed(2)} ·{" "}
                {minutesBetween(r.started_at, r.finished_at)}분
              </span>
            </div>
          </div>
        );
      })}

      <div className="sech">
        <span className="t">지난 이력</span>
        <span className="n">30일</span>
        <span className="sp" />
        <div className="chips">
          {(
            [
              ["all", "전체"],
              ["improved", "나아짐"],
              ["no_change", "변화 없음"],
              ["stuck", "막힘"],
              ["failed", "실패"]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={filter === k ? "on" : ""}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tableRows.length === 0 ? (
        <p className="empty">아직 자율 자습 이력이 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>무엇</th>
              <th>결과</th>
              <th className="num">LLM</th>
              <th className="num">비용</th>
              <th className="num">분</th>
              <th>반응</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.slice(0, 30).map((r) => (
              <tr key={r.id}>
                <td className="mut">{dayLabel(r.started_at)}</td>
                <td>{r.agenda}</td>
                <td>
                  <span className={`tag ${outcomeClass(r.outcome, r.result)}`}>
                    {outcomeLabel(r.outcome, r.result)}
                  </span>
                </td>
                <td className="num">{r.llm_calls}</td>
                <td className="num">${r.cost_usd.toFixed(2)}</td>
                <td className="num">{minutesBetween(r.started_at, r.finished_at)}</td>
                <td className="mut">
                  {typeof r.result.error === "string" && /timeout|타임아웃/i.test(r.result.error)
                    ? "타임아웃"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
