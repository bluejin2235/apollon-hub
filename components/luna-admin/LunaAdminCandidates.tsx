"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch, getAccessToken } from "@/components/luna-admin/fetch";
import { LunaCandidatesPending } from "@/components/luna/candidates/LunaCandidatesPending";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import { isSameLinkQuestion } from "@/lib/luna-admin/types";
import type { LunaQuestionRow } from "@/lib/luna-admin/types";

type Chip = "all" | "question" | "chat" | "selfstudy" | "source";

type Props = {
  onGo: (href: string) => void;
};

export function LunaAdminPending({ onGo }: Props) {
  const [chip, setChip] = useState<Chip>("all");
  const [questions, setQuestions] = useState<LunaQuestionRow[]>([]);
  const [sameNeed, setSameNeed] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const [qJson, linksJson] = await Promise.all([
        adminFetch<{ rows: LunaQuestionRow[] }>(
          "/api/luna-admin/questions?status=pending"
        ),
        adminFetch<{ same_counts?: { need: number } }>("/api/luna-admin/links?kind=same")
      ]);
      setQuestions(qJson.rows ?? []);
      setSameNeed(linksJson.same_counts?.need ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(id: string, answer: string, status: "answered" | "skipped") {
    await adminFetch("/api/luna-admin/questions", {
      method: "POST",
      body: JSON.stringify({ id, answer, status })
    });
    await load();
  }

  const otherQuestions = useMemo(
    () => questions.filter((q) => !isSameLinkQuestion(q)),
    [questions]
  );

  const showQuestions = chip === "all" || chip === "question";
  const showCandidates = chip !== "question";
  const sameHref = buildLunaAdminUrl("knowledge", "secondary", { chip: "same" });

  return (
    <>
      <div className="chips">
        {(
          [
            ["all", `전체`],
            ["question", `루나의 질문 ${otherQuestions.length}`],
            ["chat", "대화에서"],
            ["selfstudy", "자습에서"],
            ["source", "구술·문서"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={chip === key ? "on" : ""}
            onClick={() => setChip(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="empty">{error}</p> : null}

      {showQuestions && sameNeed > 0 ? (
        <div className="row">
          <span className="ic p">🔗</span>
          <div className="c">
            <div className="t">
              2차 데이터 판정이 {sameNeed.toLocaleString("ko-KR")}건 대기 중입니다
            </div>
            <div className="d">
              좌우 대조·근거·정렬은 「지식 › 2차 데이터 › 같은 것」에서 합니다.
            </div>
            <div className="btns">
              <button type="button" className="btn p sm" onClick={() => onGo(sameHref)}>
                같은 것에서 보기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showQuestions
        ? otherQuestions.map((q) => (
            <div className="row" key={q.id}>
              <span className="ic p">🌙</span>
              <div className="c">
                <div className="t">{q.question}</div>
                <div className="d">{q.why || "루나가 확인이 필요해 묻습니다."}</div>
                <div className="m">
                  확신도 {q.confidence ?? "—"}
                  {q.assignee ? " · 배정됨" : " · 아무나"}
                </div>
                <div className="btns">
                  <button
                    type="button"
                    className="btn p sm"
                    onClick={() => void answer(q.id, "같아요", "answered")}
                  >
                    같아요
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void answer(q.id, "달라요", "answered")}
                  >
                    달라요
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void answer(q.id, "모르겠어요", "answered")}
                  >
                    모르겠어요
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void answer(q.id, "", "skipped")}
                  >
                    나중에
                  </button>
                </div>
              </div>
            </div>
          ))
        : null}

      {showCandidates ? <LunaCandidatesPending /> : null}
    </>
  );
}

export function LunaAdminMine() {
  const [questions, setQuestions] = useState<LunaQuestionRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const token = await getAccessToken();
      if (!token) throw new Error("로그인이 필요합니다");
      const json = await adminFetch<{ rows: LunaQuestionRow[] }>(
        "/api/luna-admin/questions?status=pending"
      );
      setQuestions((json.rows ?? []).filter((q) => !isSameLinkQuestion(q)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(id: string, text: string, status: "answered" | "skipped") {
    await adminFetch("/api/luna-admin/questions", {
      method: "POST",
      body: JSON.stringify({ id, answer: text, status })
    });
    await load();
  }

  const list = useMemo(() => questions, [questions]);

  if (loading) return <p className="empty">불러오는 중…</p>;
  if (error) return <p className="empty">{error}</p>;
  if (list.length === 0) {
    return <p className="empty">지금 답할 질문이 없습니다. 하루 1건 제한은 없습니다.</p>;
  }

  return (
    <>
      {list.map((q) => (
        <div className="row" key={q.id}>
          <span className="ic p">🌙</span>
          <div className="c">
            <div className="t">{q.question}</div>
            <div className="d">{q.why}</div>
            <div className="btns">
              <button
                type="button"
                className="btn p sm"
                onClick={() => void answer(q.id, "맞아요", "answered")}
              >
                맞아요
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => void answer(q.id, "아니요", "answered")}
              >
                아니요
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={() => void answer(q.id, "", "skipped")}
              >
                나중에
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
