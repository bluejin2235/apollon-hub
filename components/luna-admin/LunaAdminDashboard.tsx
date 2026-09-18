"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { LunaAdminStorage } from "@/components/luna-admin/LunaAdminStorage";
import { LunaAdminResponseTiming } from "@/components/luna-admin/LunaAdminResponseTiming";
import type { AdminDashboard } from "@/lib/luna-admin/types";
import { lightEmoji } from "@/lib/luna-admin/traffic";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";

type Props = {
  onGo: (href: string) => void;
};

export function LunaAdminDashboard({ onGo }: Props) {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const json = await adminFetch<AdminDashboard>("/api/luna-admin/dashboard");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    try {
      await adminFetch("/api/luna-admin/tonight", {
        method: "POST",
        body: JSON.stringify({ action: "run" })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "실행 실패");
    } finally {
      setRunning(false);
    }
  }

  async function answerRule(id: string, accept: boolean) {
    setRuleBusy(id);
    try {
      await adminFetch("/api/luna-admin/rules", {
        method: "POST",
        body: JSON.stringify({ id, accept })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "규칙 응답 실패");
    } finally {
      setRuleBusy(null);
    }
  }

  if (error && !data) return <p className="empty">{error}</p>;
  if (!data) return <p className="empty">불러오는 중…</p>;

  const ruleQuestions = data.rule_questions ?? [];

  return (
    <>
      {ruleQuestions.length > 0 ? (
        <div className="alert" style={{ background: "#EEEDFE", borderLeftColor: "#534AB7" }}>
          <div className="c">
            <div className="t">
              🌙 루나가 규칙을 물어봅니다 · {ruleQuestions.length}건
            </div>
            <div className="d">{ruleQuestions[0]!.body}</div>
            <div className="btns" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn p"
                disabled={ruleBusy === ruleQuestions[0]!.id}
                onClick={() => void answerRule(ruleQuestions[0]!.id, true)}
              >
                맞아요
              </button>
              <button
                type="button"
                className="btn"
                disabled={ruleBusy === ruleQuestions[0]!.id}
                onClick={() => void answerRule(ruleQuestions[0]!.id, false)}
              >
                아니요
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onGo(buildLunaAdminUrl("selfstudy", "ask"))}
              >
                자세히
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {data.alerts.map((alert) => (
        <div key={alert.title} className="alert">
          <div className="c">
            <div className="t">{alert.title}</div>
            <div className="d">{alert.detail}</div>
          </div>
          <button type="button" className="btn p" onClick={() => void runNow()} disabled={running}>
            {running ? "실행 중…" : "지금 실행"}
          </button>
          <button type="button" className="btn" onClick={() => onGo(alert.href)}>
            원인 보기
          </button>
        </div>
      ))}

      <div className="flow">
        {data.stages.map((stage, i) => (
          <div key={stage.key} className={`stage ${stage.light === "green" ? "g" : stage.light === "yellow" ? "y" : "r"}`}>
            <div className="s">
              {lightEmoji(stage.light)} {stage.label}
            </div>
            <div className="t">{stage.title}</div>
            <div className="d">{stage.detail}</div>
            {i < data.stages.length - 1 ? <span className="arrow">→</span> : null}
          </div>
        ))}
      </div>

      <div className="cards">
        <div className="card">
          <div className="l">1차 데이터</div>
          <div className="v">{data.cards.primary.toLocaleString("ko-KR")}</div>
          <div className="m">{data.cards.primary_delta_label}</div>
        </div>
        <div className={`card ${data.cards.secondary === 0 ? "r" : ""}`}>
          <div className="l">2차 데이터</div>
          <div className="v">{data.cards.secondary.toLocaleString("ko-KR")}</div>
          <div className="m">{data.cards.secondary_note}</div>
        </div>
        <div className="card">
          <div className="l">이번 주 대화</div>
          <div className="v">
            {data.cards.talk_week}
            <span className="u">건</span>
          </div>
          <div className="m">{data.cards.talk_users}명</div>
        </div>
        <div className={`card ${data.cards.my_turn > 0 ? "y" : ""}`}>
          <div className="l">내가 답할 것</div>
          <div className="v">{data.cards.my_turn}</div>
          <div className="m">{data.cards.my_turn_note}</div>
        </div>
      </div>

      <div className="sech">
        <span className="t">오늘 밤 할 일</span>
        <span className="n">{data.tonight_label}</span>
        <span className="sp" />
        <button
          type="button"
          className="a"
          onClick={() => onGo(buildLunaAdminUrl("selfstudy", "tonight"))}
        >
          자습 →
        </button>
      </div>
      {data.tonight.length === 0 ? (
        <p className="empty">오늘 밤 할 일로 올라온 것이 없습니다.</p>
      ) : (
        data.tonight.map((item, i) => (
          <div className="row" key={item.id}>
            <span className="ic p">{i + 1}</span>
            <div className="c">
              <div className="t">{item.title}</div>
              <div className="d">{item.why}</div>
            </div>
            <span className="rt">{item.effect}</span>
          </div>
        ))
      )}

      {data.storage ? <LunaAdminStorage data={data.storage} /> : null}
      {data.response_timing ? (
        <LunaAdminResponseTiming data={data.response_timing} />
      ) : null}
    </>
  );
}
