"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { AnalysisPayload } from "@/lib/luna-admin/types";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

type Props = {
  onGo: (href: string) => void;
};

export function LunaAdminAnalysis({ onGo }: Props) {
  const [data, setData] = useState<AnalysisPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      setData(await adminFetch<AnalysisPayload>("/api/luna-admin/analysis"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(topic: string, failure_ids: string[], failure_label: string, dest: string) {
    setBusy(topic);
    try {
      await adminFetch("/api/luna-admin/analysis", {
        method: "POST",
        body: JSON.stringify({ topic, failure_ids, failure_label })
      });
      onGo(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "보내기 실패");
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  return (
    <>
      <div className="sech">
        <span className="t">분석 결과</span>
        <span className="n">열린 실패 {data.total}건을 읽었습니다</span>
      </div>

      {data.groups.length === 0 ? (
        <p className="empty">묶을 실패가 없습니다.</p>
      ) : (
        data.groups.map((group) => (
          <div className="row" key={group.cause}>
            <span className="ic r">{group.emoji}</span>
            <div className="c">
              <div className="t">
                {group.title} <span className="tag r">{group.count}건</span>
              </div>
              <div className="d">
                <b>공통 원인</b> — {group.common_cause}
              </div>
              {group.samples.length > 0 ? (
                <div className="m">{group.samples.join(" · ")}</div>
              ) : null}
              <div className="btns">
                {group.actions.map((action, i) => {
                  const dest =
                    action.when === "brain"
                      ? buildLunaAdminUrl("brain", "upgrade")
                      : buildLunaAdminUrl("selfstudy", "tonight");
                  const whenLabel =
                    action.when === "tonight"
                      ? "오늘 밤"
                      : action.when === "tomorrow"
                        ? "내일 밤"
                        : "두뇌로";
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={`btn sm ${i === 0 && action.when === "tonight" ? "p" : ""}`}
                      disabled={busy === action.title}
                      onClick={() =>
                        void send(action.title, group.failure_ids, group.title, dest)
                      }
                    >
                      {i + 1} {action.title} — {whenLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))
      )}

      {data.inspect_count > 0 ? (
        <div className="row">
          <span className="ic g">✓</span>
          <div className="c">
            <div className="t">
              정기 점검 <span className="tag gray">{data.inspect_count}건</span>
            </div>
            <div className="d">사람이 겪은 게 아니라 루나가 스스로 돌린 점검입니다.</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
