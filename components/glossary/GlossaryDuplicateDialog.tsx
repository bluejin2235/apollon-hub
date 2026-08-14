"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  GlossaryCategoryToggles,
  SynonymTagInput
} from "@/components/glossary/GlossaryFields";
import type { GlossaryDupMatch, GlossaryDupTerm } from "@/lib/glossary/duplicate";
import type { GlossaryFieldValues } from "@/lib/glossary/types";

const C = {
  line: "#e7e8ec",
  ink: "#1c1d21",
  sub: "#6b6f76",
  faint: "#9aa0a8",
  chip: "#f1f2f5",
  warnBg: "#FAECE7",
  warnInk: "#993C1D",
  luna: "#534AB7"
};

export type GlossaryDupAction = "merge" | "replace" | "keep" | "register";

export type GlossaryDuplicatePayload = {
  primary: GlossaryDupMatch;
  others: GlossaryDupMatch[];
  existing: GlossaryDupTerm;
  incoming: GlossaryFieldValues;
  merge_draft: GlossaryFieldValues | null;
  source_label?: string;
  candidate_id?: string | null;
  /** 용어사전 수정 중이면 자기 id */
  exclude_id?: string | null;
};

type Props = {
  open: boolean;
  payload: GlossaryDuplicatePayload | null;
  busy?: boolean;
  onCancel: () => void;
  onResolve: (args: {
    action: GlossaryDupAction;
    merged: GlossaryFieldValues;
    incoming: GlossaryFieldValues;
  }) => void;
};

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-semibold" style={{ color: C.faint }}>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  bold
}: {
  label: string;
  value: string | null | undefined;
  bold?: boolean;
}) {
  const v = (value ?? "").trim();
  return (
    <div className="mb-2">
      <Label>{label}</Label>
      <div
        className={`text-[13px] ${bold && v ? "font-bold" : ""}`}
        style={{ color: v ? C.ink : C.faint }}
      >
        {v || "—"}
      </div>
    </div>
  );
}

function CompareColumn({
  badge,
  emphasize,
  meta,
  fields
}: {
  badge: string;
  emphasize?: boolean;
  meta: string;
  fields: GlossaryFieldValues;
}) {
  return (
    <div
      className="rounded-[10px] p-3"
      style={{
        border: emphasize ? `2px solid ${C.warnInk}` : `0.5px solid ${C.line}`,
        background: "#fff"
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
          style={
            emphasize
              ? { background: C.warnBg, color: C.warnInk }
              : { background: C.chip, color: C.sub }
          }
        >
          {badge}
        </span>
        <span className="text-[11px]" style={{ color: C.faint }}>
          {meta}
        </span>
      </div>
      <Field label="용어명" value={fields.term_ko} bold />
      <Field label="ENGLISH" value={fields.term_en} />
      <Field label="中文" value={fields.term_zh} bold />
      <Field
        label="분류"
        value={fields.categories.length ? fields.categories.join(", ") : null}
      />
      <Field
        label="동의어"
        value={fields.synonyms.length ? fields.synonyms.join(", ") : null}
      />
      <Field label="정의" value={fields.definition} />
    </div>
  );
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const ACTION_LABEL: Record<GlossaryDupAction, string> = {
  merge: "이대로 합치기",
  replace: "교체",
  keep: "유지",
  register: "등록"
};

export function GlossaryDuplicateDialog({
  open,
  payload,
  busy,
  onCancel,
  onResolve
}: Props) {
  const [action, setAction] = useState<GlossaryDupAction>("merge");
  const [merged, setMerged] = useState<GlossaryFieldValues | null>(null);
  const [incomingEdit, setIncomingEdit] = useState<GlossaryFieldValues | null>(
    null
  );

  useEffect(() => {
    if (!open || !payload) return;
    setAction("merge");
    setMerged(
      payload.merge_draft ?? {
        ...payload.incoming
      }
    );
    setIncomingEdit({ ...payload.incoming });
  }, [open, payload]);

  if (!open || !payload || !merged || !incomingEdit) return null;

  const existingFields: GlossaryFieldValues = {
    term_ko: payload.existing.term_ko,
    term_en: payload.existing.term_en ?? "",
    term_zh: payload.existing.term_zh ?? "",
    synonyms: payload.existing.synonyms ?? [],
    definition: payload.existing.definition ?? "",
    categories: payload.existing.categories?.length
      ? payload.existing.categories
      : ["공통"]
  };

  const existingMeta = `v${payload.existing.version} · ${shortDate(
    payload.existing.updated_at
  )} · ${payload.existing.updated_by_name || "—"}`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-3"
      role="dialog"
      aria-modal
      aria-labelledby="glossary-dup-title"
    >
      <div
        className="max-h-[min(92dvh,720px)] w-full max-w-[720px] overflow-y-auto rounded-[14px] bg-white shadow-xl"
        style={{ border: `0.5px solid ${C.line}` }}
      >
        <div
          className="flex items-start gap-2.5 px-4 py-3"
          style={{ background: C.warnBg, color: C.warnInk }}
        >
          <span className="mt-0.5 text-[18px] leading-none" aria-hidden>
            ⚠
          </span>
          <div className="min-w-0 flex-1">
            <div
              id="glossary-dup-title"
              className="text-[14px] font-extrabold"
            >
              이미 있는 용어와 겹쳐요
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug">
              {payload.primary.message}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 min-[701px]:grid-cols-2">
          <CompareColumn
            badge="사전에 있는 것"
            meta={existingMeta}
            fields={existingFields}
          />
          <CompareColumn
            badge="새로 올린 것"
            emphasize
            meta={payload.source_label || "신규"}
            fields={payload.incoming}
          />
        </div>

        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: C.line }}>
          {(
            [
              ["merge", "합치기 — 두 정의를 하나로 정리해 기존 용어를 갱신"],
              ["replace", "새 것으로 교체 — 기존 내용을 새 내용으로 덮어씀"],
              ["keep", "기존 것 유지 — 새로 올린 것은 폐기"],
              ["register", "다른 용어로 등록 — 이름을 바꿔 별개 용어로 추가"]
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-start gap-2 text-[13px]"
              style={{ color: C.ink }}
            >
              <input
                type="radio"
                className="mt-1"
                name="glossary-dup-action"
                checked={action === key}
                onChange={() => setAction(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {action === "merge" ? (
          <div className="border-t px-4 py-3" style={{ borderColor: C.line }}>
            <div className="mb-2 text-[12px] font-bold" style={{ color: C.sub }}>
              병합 편집 (초안은 루나가 만들었어요 — 고칠 수 있습니다)
            </div>
            <div className="mb-2 grid grid-cols-1 gap-2 min-[701px]:grid-cols-3">
              {(
                [
                  ["term_ko", "한국어"],
                  ["term_en", "ENGLISH"],
                  ["term_zh", "中文"]
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <input
                    className="w-full rounded-[8px] border px-2.5 py-1.5 text-[13px]"
                    style={{ borderColor: C.line, color: C.ink }}
                    value={merged[key]}
                    onChange={(e) =>
                      setMerged({ ...merged, [key]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="mb-2">
              <Label>정의</Label>
              <textarea
                className="min-h-[88px] w-full rounded-[8px] border px-2.5 py-1.5 text-[13px]"
                style={{ borderColor: C.line, color: C.ink }}
                value={merged.definition}
                onChange={(e) =>
                  setMerged({ ...merged, definition: e.target.value })
                }
              />
            </div>
            <div className="mb-2">
              <Label>분류</Label>
              <GlossaryCategoryToggles
                value={merged.categories}
                onChange={(categories) => setMerged({ ...merged, categories })}
              />
            </div>
            <div>
              <Label>동의어</Label>
              <SynonymTagInput
                value={merged.synonyms}
                onChange={(synonyms) => setMerged({ ...merged, synonyms })}
              />
            </div>
          </div>
        ) : null}

        {action === "register" ? (
          <div className="border-t px-4 py-3" style={{ borderColor: C.line }}>
            <div className="mb-2 text-[12px] font-bold" style={{ color: C.sub }}>
              새 용어명 (다시 중복 검사합니다)
            </div>
            <div className="mb-2 grid grid-cols-1 gap-2 min-[701px]:grid-cols-3">
              {(
                [
                  ["term_ko", "한국어"],
                  ["term_en", "ENGLISH"],
                  ["term_zh", "中文"]
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <input
                    className="w-full rounded-[8px] border px-2.5 py-1.5 text-[13px]"
                    style={{ borderColor: C.line, color: C.ink }}
                    value={incomingEdit[key]}
                    onChange={(e) =>
                      setIncomingEdit({
                        ...incomingEdit,
                        [key]: e.target.value
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {payload.others.length > 0 ? (
          <div
            className="border-t px-4 py-2.5 text-[12px]"
            style={{ borderColor: C.line, color: C.sub }}
          >
            <div className="mb-1 font-bold" style={{ color: C.faint }}>
              그 밖의 겹침
            </div>
            <ul className="list-inside list-disc space-y-0.5">
              {payload.others.map((o, i) => (
                <li key={`${o.kind}-${o.existing_id}-${i}`}>{o.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div
          className="flex flex-wrap items-center gap-2 border-t px-4 py-3"
          style={{ borderColor: C.line }}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onResolve({
                action,
                merged,
                incoming:
                  action === "register" ? incomingEdit : payload.incoming
              })
            }
            className="rounded-[9px] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: C.luna }}
          >
            {busy ? "처리 중…" : ACTION_LABEL[action]}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-[9px] border px-3.5 py-2 text-[13px] font-bold disabled:opacity-50"
            style={{ borderColor: C.line, color: C.sub }}
          >
            취소
          </button>
          <span className="ml-auto text-[11px]" style={{ color: C.faint }}>
            모든 처리는 변경 이력에 남습니다
          </span>
        </div>
      </div>
    </div>
  );
}
