"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ErrorLine,
  FilterChip,
  getAccessToken,
  KnowledgeShell,
  LoadingLine,
  ReplyRow,
  SourceBadge,
  useCandidateNav
} from "@/components/luna/candidates/shared";
import { Btn, ListCard, ListItem } from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
import type { CandidateSource } from "@/lib/luna/candidates";

type AssignedQuestion = {
  id: string;
  greeting: string;
  question: string;
  subtitle: string;
  hint: string;
  deadline_label: string | null;
  turn_label: string | null;
};

type DialogueRow = {
  id: string;
  source: CandidateSource;
  title: string;
  turn_label: string;
};

type TeamRow = {
  user_id: string | null;
  name: string;
  count: number;
};

export function LunaCandidatesMine() {
  const go = useCandidateNav();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigned, setAssigned] = useState<AssignedQuestion | null>(null);
  const [dialogues, setDialogues] = useState<DialogueRow[]>([]);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setError("로그인이 필요합니다");
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/luna/candidates/mine", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError(`불러오기 실패 (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        assigned_question?: AssignedQuestion | null;
        my_dialogues?: DialogueRow[];
        team_overview?: TeamRow[];
      };
      setAssigned(json.assigned_question ?? null);
      setDialogues(json.my_dialogues ?? []);
      setTeam(json.team_overview ?? []);
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function popupRespond(
    id: string,
    action: "yes" | "no" | "later" | "answer",
    text?: string
  ) {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/luna/popup/respond", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, action, text })
      });
      if (!res.ok) {
        setMessage(`처리 실패: ${await res.text()}`);
        return;
      }
      const json = (await res.json()) as { status?: string; message?: string };
      setMessage(json.message ?? "처리했어요");
      setReply("");
      await load();
      if (json.status === "candidate" && action !== "later") {
        go("pending");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <KnowledgeShell>
        <LoadingLine />
      </KnowledgeShell>
    );
  }

  const teamSummary =
    team.length > 0
      ? team.map((t) => `${t.name} ${t.count}건`).join(" · ")
      : "대기 질문 없음";

  return (
    <KnowledgeShell>
      {error ? <ErrorLine message={error} /> : null}
      {message ? (
        <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
          {message}
        </p>
      ) : null}

      <div
        className="mb-3.5 rounded-[9px] px-3.5 py-[11px] text-[13px]"
        style={{ background: K.panel, color: K.sub }}
      >
        내 대화에서 나온 질문만 나에게 배정됩니다. 하루 1건을 넘기지 않아요.
      </div>

      {assigned ? (
        <div
          className="mb-3 rounded-[12px] px-4 py-4"
          style={{ background: K.panel, border: "2px solid #d9cdf7" }}
        >
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <div
              className="grid h-[26px] w-[26px] place-items-center rounded-full text-[11px] font-extrabold"
              style={{ background: K.luna, color: K.lunaSoft }}
            >
              L
            </div>
            <div className="flex-1 text-[13.5px] font-bold">{assigned.greeting}</div>
            <span className="text-[11.5px]" style={{ color: K.faint }}>
              {assigned.subtitle}
              {assigned.deadline_label ? ` · ${assigned.deadline_label}` : ""}
            </span>
          </div>
          <p className="mb-1 text-[14px] leading-relaxed">{assigned.question}</p>
          {assigned.hint ? (
            <p className="mb-2 text-[12px]" style={{ color: K.sub }}>
              {assigned.hint}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Btn
              primary
              disabled={busy}
              onClick={() => void popupRespond(assigned.id, "yes")}
            >
              네 맞아요
            </Btn>
            <Btn disabled={busy} onClick={() => void popupRespond(assigned.id, "no")}>
              아니에요
            </Btn>
            <button
              type="button"
              disabled={busy}
              className="px-2 text-[12.5px] font-bold disabled:opacity-50"
              style={{ color: K.faint }}
              onClick={() => void popupRespond(assigned.id, "later")}
            >
              나중에
            </button>
          </div>
          <ReplyRow
            value={reply}
            onChange={setReply}
            busy={busy}
            placeholder="또는 직접 설명해 주세요"
            onSend={() => {
              const t = reply.trim();
              if (!t) return;
              void popupRespond(assigned.id, "answer", t);
            }}
          />
        </div>
      ) : (
        <p className="mb-4 text-[12px]" style={{ color: K.faint }}>
          지금 답할 배정 질문이 없어요
        </p>
      )}

      <h4 className="mb-2 mt-4 text-[13px] font-bold">
        내가 시작한 문답{" "}
        <span className="font-normal" style={{ color: K.faint }}>
          진행 중
        </span>
      </h4>

      {dialogues.length === 0 ? (
        <p className="mb-4 text-[12px]" style={{ color: K.faint }}>
          진행 중인 문답이 없습니다
        </p>
      ) : (
        <ListCard>
          {dialogues.map((d) => (
            <ListItem key={d.id}>
              <div className="flex flex-wrap items-center gap-2.5">
                <SourceBadge source={d.source} />
                <span className="flex-1 text-[13px]">{d.title}</span>
                <span className="text-[11.5px]" style={{ color: K.faint }}>
                  {d.turn_label}
                </span>
                <Btn onClick={() => go("pending")}>이어서 답하기</Btn>
              </div>
            </ListItem>
          ))}
        </ListCard>
      )}

      <div
        className="mt-3.5 flex flex-wrap items-center gap-3 rounded-[9px] px-3.5 py-3"
        style={{ background: K.panel }}
      >
        <div className="flex-1">
          <div className="text-[13px]">팀 전체 대기 현황</div>
          <div className="text-[12px]" style={{ color: K.sub }}>
            {teamSummary}
          </div>
        </div>
        <Btn disabled title="준비 중">
          배정 관리
        </Btn>
      </div>
    </KnowledgeShell>
  );
}
