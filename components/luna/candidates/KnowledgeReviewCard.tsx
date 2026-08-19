"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type {
  CandidateRow,
  ReviewProposal
} from "@/components/luna/candidates/shared";
import { Btn } from "@/components/luna/knowledge/ui";
import { stripConfirmClaimDisplay } from "@/lib/luna/candidate-format";
import { formatKoreanDay, K, sourceLabel } from "@/lib/luna/knowledge-format";

const OLD = { ink: "#8A6D2F", bg: "#FAF7EE" };
const NEW = { ink: "#0F6E56", bg: "#EAF7F2" };
const LOCK = { ink: "#8A6D2F", bg: "#FAF3E2" };
const CORR = { ink: "#8A3B12", bg: "#F8EDE6" };

const CATEGORY_OPTIONS = [
  { id: "general", label: "일반" },
  { id: "criterion", label: "판단기준" },
  { id: "workflow", label: "일하는 방식" },
  { id: "client", label: "고객" },
  { id: "preference", label: "선호" }
] as const;

export type KnowledgeReviewAction =
  | "accept_proposal"
  | "keep_both"
  | "replace_with_new"
  | "discard_new"
  | "rewrite"
  | "accept_existing"
  | "accept_new"
  | "confirm"
  | "later"
  | "reject";

export type KnowledgeRegisterOpts = {
  as_is?: boolean;
  category?: string;
  importance?: number;
};

function wikiCorrection(
  meta: Record<string, unknown> | null | undefined
): { title: string; section: string; slug: string } | null {
  const raw = meta?.wiki_correction;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const section = typeof row.section === "string" ? row.section.trim() : "";
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!title) return null;
  return { title, section: section || "본문", slug };
}

function AutoGrowTextarea({
  value,
  onChange,
  disabled
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={2}
      disabled={disabled}
      className="w-full rounded-[9px] border px-2.5 py-2 text-[13px] leading-[1.8]"
      style={{
        borderColor: K.luna,
        background: "#FCFCFD",
        overflow: "hidden",
        resize: "none"
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function KnowledgeReviewCard({
  item,
  busy,
  error,
  onAction
}: {
  item: CandidateRow;
  busy: boolean;
  error?: string;
  onAction: (
    action: KnowledgeReviewAction,
    text?: string,
    rejectNote?: string,
    opts?: KnowledgeRegisterOpts
  ) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [editCategory, setEditCategory] = useState(
    CATEGORY_OPTIONS.some((c) => c.id === item.category)
      ? item.category
      : "general"
  );
  const [editImportance, setEditImportance] = useState(
    item.importance && item.importance >= 1 && item.importance <= 5
      ? item.importance
      : 3
  );
  const [extrasOpen, setExtrasOpen] = useState(false);

  const isDup = Boolean(item.duplicate);
  const proposal: ReviewProposal | null = item.proposal ?? null;
  const kind = proposal?.kind ?? (isDup ? "rewrite" : "new");
  const sentence = proposal?.sentence || item.content;
  const reason = proposal?.reason || "";
  const correction = wikiCorrection(item.meta);
  const isCorrection =
    Boolean(correction) || item.meta?.from_correction === true;

  const tag = isCorrection ? "정정" : isDup ? "겹침" : "새 지식";
  const title = isCorrection
    ? "위키와 다른 정정이에요"
    : isDup
      ? "아폴론 지식과 비슷한 내용이에요"
      : "처음 듣는 내용이에요";
  const proposeLabel = isDup ? "🌙 이렇게 하려고 해요" : "🌙 이렇게 이해했어요";

  const existingMeta = item.duplicate
    ? [
        formatKoreanDay(item.duplicate.created_at),
        item.duplicate.version_count > 0
          ? `${item.duplicate.version_count}번 고쳐짐`
          : null
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const incomingMeta = [
    formatKoreanDay(item.created_at),
    sourceLabel(item.source)
  ]
    .filter((v) => v && v !== "—")
    .join(" · ");

  function openEdit() {
    setEditText(sentence);
    setEditOpen(true);
  }

  function registerEdited() {
    const next = editText.trim();
    if (!next) return;
    onAction("confirm", next, undefined, {
      as_is: true,
      category: editCategory,
      importance: editImportance
    });
  }

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
          style={
            isCorrection
              ? { background: CORR.bg, color: CORR.ink }
              : isDup
                ? { background: LOCK.bg, color: LOCK.ink }
                : { background: NEW.bg, color: NEW.ink }
          }
        >
          {tag}
        </span>
        <span className="text-[12px] font-semibold">{title}</span>
      </div>

      <div className="px-[15px] py-[15px]">
        {isCorrection ? (
          <div
            className="mb-3 rounded-[10px] px-3 py-2.5 text-[12px] leading-[1.7]"
            style={{ background: CORR.bg, color: CORR.ink }}
          >
            {correction
              ? `위키 「${correction.title}」의 「${correction.section}」와 다릅니다. 위키 문서를 고쳐 주세요.`
              : "사람이 정정한 내용입니다. 위키 문서도 맞춰 고쳐 주세요."}
            {correction?.slug ? (
              <a
                href={`/wiki/${correction.slug}`}
                className="mt-1 block text-[11px] underline"
              >
                위키 문서 열기
              </a>
            ) : null}
          </div>
        ) : null}

        {isDup && item.duplicate ? (
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
                이미 아는 것
              </div>
              <div className="text-[12.5px] leading-[1.75]">
                {stripConfirmClaimDisplay(item.duplicate.content)}
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
                새로 들은 것
              </div>
              <div className="text-[12.5px] leading-[1.75]">
                {stripConfirmClaimDisplay(item.content)}
              </div>
              {incomingMeta ? (
                <div className="mt-1.5 text-[10px]" style={{ color: K.faint }}>
                  {incomingMeta}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {item.duplicate && item.duplicate.extra_count > 0 ? (
          <div className="mb-3">
            <button
              type="button"
              className="text-[11px]"
              style={{ color: K.faint }}
              onClick={() => setExtrasOpen((v) => !v)}
            >
              이 밖에 {item.duplicate.extra_count}건과도 비슷해요
              {extrasOpen ? " ▲" : " ▼"}
            </button>
            {extrasOpen ? (
              <ul className="mt-1.5 space-y-1">
                {item.duplicate.extras.map((ex) => (
                  <li
                    key={ex.id}
                    className="rounded-[8px] px-2.5 py-1.5 text-[12px] leading-relaxed"
                    style={{ background: K.chip, color: K.sub }}
                  >
                    {ex.content}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

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
            {proposeLabel}
          </div>
          {editOpen ? (
            <>
              <AutoGrowTextarea
                value={editText}
                onChange={setEditText}
                disabled={busy}
              />
              <div className="mt-2.5 flex flex-wrap gap-3 text-[12px]">
                <label className="flex items-center gap-1.5">
                  <span style={{ color: K.sub }}>분류</span>
                  <select
                    className="rounded-[8px] border px-2 py-1"
                    style={{ borderColor: K.line, background: K.panel }}
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    disabled={busy}
                  >
                    {CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span style={{ color: K.sub }}>중요도</span>
                  <select
                    className="rounded-[8px] border px-2 py-1"
                    style={{ borderColor: K.line, background: K.panel }}
                    value={editImportance}
                    onChange={(e) =>
                      setEditImportance(Number(e.target.value))
                    }
                    disabled={busy}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : kind === "conflict" ? (
            <p className="text-[13px] leading-[1.8]" style={{ color: K.sub }}>
              {reason || "어느 쪽이 맞는지 골라 주세요."}
            </p>
          ) : (
            <div className="text-[13px] leading-[1.8]">
              {stripConfirmClaimDisplay(sentence)}
            </div>
          )}
          {!editOpen && kind !== "conflict" && reason ? (
            <p className="mt-2 text-[11px] leading-[1.6]" style={{ color: K.faint }}>
              {reason}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mb-2 text-[12px]" style={{ color: K.danger }}>
            {error}
          </p>
        ) : null}

        {editOpen ? (
          <div className="flex items-center gap-[7px]">
            <Btn
              primary
              disabled={busy || !editText.trim()}
              onClick={registerEdited}
            >
              {busy ? "처리 중…" : "이대로 등록"}
            </Btn>
            <Btn
              disabled={busy}
              onClick={() => {
                setEditOpen(false);
                setEditText("");
              }}
            >
              취소
            </Btn>
          </div>
        ) : (
          <div className="flex items-center gap-[7px]">
            {kind === "conflict" ? (
              <>
                <Btn
                  disabled={busy}
                  onClick={() => onAction("accept_existing")}
                >
                  이미 아는 것이 맞아요
                </Btn>
                <Btn
                  primary
                  disabled={busy}
                  onClick={() => onAction("accept_new")}
                >
                  새로 들은 것이 맞아요
                </Btn>
              </>
            ) : (
              <Btn
                primary
                disabled={busy}
                onClick={() => onAction("accept_proposal")}
              >
                {busy ? "처리 중…" : "맞아요"}
              </Btn>
            )}
            {kind !== "conflict" ? (
              <Btn disabled={busy} onClick={openEdit}>
                수정
              </Btn>
            ) : null}
            <Btn
              disabled={busy}
              onClick={() => onAction("discard_new")}
            >
              삭제
            </Btn>
          </div>
        )}
      </div>
    </article>
  );
}
