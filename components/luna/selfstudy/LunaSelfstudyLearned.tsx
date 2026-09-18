"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { ruleQuestionText } from "@/lib/luna/rules-shared";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import type { LinkProgressPayload } from "@/lib/luna-admin/types";

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

type Props = {
  onGo?: (href: string) => void;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function appliedCount(row: RuleRow): number {
  if (typeof row.applied_count === "number") return row.applied_count;
  if (typeof row.evidence?.applied_count === "number") {
    return row.evidence.applied_count as number;
  }
  if (typeof row.evidence?.impact === "number") return row.evidence.impact as number;
  return row.signal_count;
}

export function LunaSelfstudyLearned({ onGo }: Props) {
  const [filter, setFilter] = useState<Filter>("active");
  const [data, setData] = useState<Payload | null>(null);
  const [progress, setProgress] = useState<LinkProgressPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const [json, prog] = await Promise.all([
        adminFetch<Payload>("/api/luna-admin/rules"),
        adminFetch<LinkProgressPayload>("/api/luna-admin/link-progress").catch(
          () => null
        )
      ]);
      setData(json);
      setProgress(prog);
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
  const auto = progress?.auto ?? 0;
  const ask = progress?.ask ?? 0;
  const sameTotal = auto + ask;
  const samePct =
    sameTotal > 0 ? Math.min(100, Math.round((auto / sameTotal) * 100)) : 0;

  return (
    <>
      <div className="chips subchips" style={{ marginBottom: 14 }}>
        {(
          [
            ["active", `활성 ${data.counts.active}`],
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
        rows.map((row) => {
          const n = appliedCount(row);
          return (
            <div className={`rule${row.status === "candidate" ? " cand" : ""}`} key={row.id}>
              <div className="q">{ruleQuestionText(row)}</div>
              <div className="ev">
                {row.confirmed_at
                  ? `${formatWhen(row.confirmed_at)} 에 확인 · `
                  : "후보 · "}
                근거 신호 <b>{row.signal_count}건</b>
                <br />
                {filter === "active" ? (
                  <>
                    <b>지금까지 {n}건</b>을 이 규칙으로 정리했습니다.
                  </>
                ) : filter === "candidate" ? (
                  <>정하면 비슷한 건이 한 번에 정리됩니다.</>
                ) : (
                  <>버린 규칙입니다.</>
                )}
              </div>
              <div className="meta">
                {row.scope} · {row.pattern_type} · {row.pattern_value}
              </div>
              <div className="acts">
                {filter === "candidate" ? (
                  <>
                    <button
                      type="button"
                      className="btn sm p"
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
                  </>
                ) : filter === "active" ? (
                  <>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() =>
                        onGo?.(buildLunaAdminUrl("knowledge", "secondary"))
                      }
                    >
                      적용된 {n}건 보기
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy === row.id}
                      onClick={() => void answer(row.id, false)}
                    >
                      되돌리기
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {filter === "active" && progress ? (
        <>
          <div className="sech">
            <span className="t">이 규칙으로 무엇이 나아졌나</span>
          </div>
          <div className="g2">
            <div className="prog">
              <div className="ph">
                <span className="t">「같은 것」 확인 필요</span>
                <span className="v">
                  {sameTotal} → {ask}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${samePct}%`, background: "var(--g)" }} />
              </div>
              <div className="d">
                {auto > 0
                  ? `자동 처리 ${auto.toLocaleString("ko-KR")}건 · 남은 확인 ${ask.toLocaleString("ko-KR")}건`
                  : `남은 확인 ${ask.toLocaleString("ko-KR")}건`}
              </div>
            </div>
            <div className="prog">
              <div className="ph">
                <span className="t">보류</span>
                <span className="v">{(progress.hold ?? 0).toLocaleString("ko-KR")}건</span>
              </div>
              <div className="bar">
                <i
                  style={{
                    width: `${Math.min(100, progress.overall_pct)}%`,
                    background: "var(--g)"
                  }}
                />
              </div>
              <div className="d">연도별 2차 데이터 진행 {progress.overall_pct}%</div>
            </div>
          </div>
        </>
      ) : null}
      {error ? <p className="empty">{error}</p> : null}
    </>
  );
}
