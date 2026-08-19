"use client";

import type { CandidateRow } from "@/components/luna/candidates/shared";
import { Btn } from "@/components/luna/knowledge/ui";
import { parseGlossaryMeta } from "@/lib/luna/candidate-format";
import { formatKoreanDay, K } from "@/lib/luna/knowledge-format";

const OLD = { ink: "#8A6D2F", bg: "#FAF7EE" };
const NEW = { ink: "#0F6E56", bg: "#EAF7F2" };
const LOCK = { ink: "#8A6D2F", bg: "#FAF3E2" };

export function TermReviewCard({
  item,
  busy,
  error,
  onAccept,
  onReject,
  onLater
}: {
  item: CandidateRow;
  busy: boolean;
  error?: string;
  onAccept: () => void;
  onReject: () => void;
  onLater: () => void;
}) {
  const draft = parseGlossaryMeta(item.meta, item.content);
  const match = item.glossary_match ?? null;
  const askedTerm =
    typeof item.meta?.asked_term === "string" && item.meta.asked_term.trim()
      ? item.meta.asked_term.trim()
      : "";
  const askedCountRaw = Number(item.meta?.asked_count);
  const askedCount =
    Number.isFinite(askedCountRaw) && askedCountRaw > 0 ? askedCountRaw : null;
  const proposal = item.glossary_proposal ?? {
    term_ko: draft.term_ko,
    definition: draft.definition,
    mode: match ? ("update" as const) : ("insert" as const)
  };
  const termName = askedTerm || proposal.term_ko || draft.term_ko || "용어";
  const definition =
    (typeof item.meta?.draft_definition === "string" &&
      item.meta.draft_definition.trim()) ||
    proposal.definition ||
    draft.definition ||
    item.content;
  const modeLabel =
    proposal.mode === "update"
      ? "기존 뜻을 이렇게 바꾸기"
      : "용어사전에 새로 추가";
  const existingMeta = match
    ? [
        formatKoreanDay(match.updated_at),
        match.version > 1 ? `v${match.version}` : null
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <article
      className="overflow-hidden rounded-[12px]"
      style={{ border: `1px solid ${K.line}`, background: K.panel }}
    >
      <div
        className="flex items-center gap-2 px-[15px] py-[11px]"
        style={{
          background: "#FBFBFC",
          borderBottom: `1px solid ${K.line2}`
        }}
      >
        <span
          className="rounded-[9px] px-[7px] py-0.5 text-[9.5px] font-bold"
          style={{ background: LOCK.bg, color: LOCK.ink }}
        >
          용어
        </span>
        <span className="text-[12px] font-semibold">
          {askedTerm ? `${termName} 뜻을 물었습니다` : "용어사전에 넣을까요?"}
        </span>
        {askedCount ? (
          <span className="ml-auto text-[10.5px]" style={{ color: K.faint }}>
            {askedCount}회 질문
          </span>
        ) : (
          <span className="ml-auto text-[10.5px]" style={{ color: K.faint }}>
            {item.author_name ? `${item.author_name}와의 대화` : ""}
          </span>
        )}
      </div>

      <div className="px-[15px] py-[15px]">
        {askedTerm ? (
          <p className="mb-3 text-[11.5px]" style={{ color: K.faint }}>
            {[
              item.author_name ? `${item.author_name}이 물음` : null,
              formatKoreanDay(item.created_at),
              askedCount && askedCount > 1 ? `${askedCount}회` : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <div
          className="mb-3.5 flex overflow-hidden rounded-[10px]"
          style={{ border: `1px solid ${K.line}` }}
        >
          <div
            className="min-w-0 flex-1 px-3.5 py-3"
            style={{
              background: OLD.bg,
              borderRight: `1px solid ${K.line}`
            }}
          >
            <div
              className="mb-1.5 text-[10px] font-bold"
              style={{ color: OLD.ink }}
            >
              이미 있는 뜻
            </div>
            <div className="text-[12.5px] leading-[1.75]">
              {match?.definition?.trim() || "아직 없는 용어예요"}
            </div>
            {existingMeta ? (
              <div className="mt-1.5 text-[10px]" style={{ color: K.faint }}>
                {existingMeta}
              </div>
            ) : null}
          </div>
          <div
            className="min-w-0 flex-1 px-3.5 py-3"
            style={{ background: NEW.bg }}
          >
            <div
              className="mb-1.5 text-[10px] font-bold"
              style={{ color: NEW.ink }}
            >
              {askedTerm ? "정의 초안" : "새로 들은 뜻"}
            </div>
            <div className="text-[12.5px] leading-[1.75]">{definition}</div>
          </div>
        </div>

        <div
          className="mb-3 rounded-[10px] px-[15px] py-[13px]"
          style={{
            border: `1px solid ${K.lunaSoft}`,
            background: "#FCFBFF"
          }}
        >
          <div
            className="mb-1.5 text-[11px] font-bold"
            style={{ color: K.lunaInk }}
          >
            🌙 이렇게 하려고 해요
          </div>
          <div className="text-[13px] font-semibold leading-[1.8]">{termName}</div>
          <div className="text-[13px] leading-[1.8]">{definition}</div>
          <p className="mt-2 text-[11px] leading-[1.6]" style={{ color: K.faint }}>
            → {modeLabel}
          </p>
        </div>

        {error ? (
          <p className="mb-2 text-[12px]" style={{ color: K.danger }}>
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-[7px]">
          <Btn primary disabled={busy} onClick={onAccept}>
            {busy ? "처리 중…" : "맞아요"}
          </Btn>
          <Btn disabled={busy} onClick={onReject}>
            아니에요
          </Btn>
          <span className="flex-1" />
          <Btn disabled={busy} className="bg-transparent" onClick={onLater}>
            나중에
          </Btn>
        </div>
      </div>
    </article>
  );
}
