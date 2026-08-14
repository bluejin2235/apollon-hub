"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  luna: "#534AB7",
  coral: "#E36B5B"
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
  /** 편집 중인 용어의 표시명 (삭제 안내용) */
  editing_term_ko?: string | null;
};

type Props = {
  open: boolean;
  payload: GlossaryDuplicatePayload | null;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onResolve: (args: {
    action: GlossaryDupAction;
    merged: GlossaryFieldValues;
    incoming: GlossaryFieldValues;
    survivor_id: string;
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

function quoteNames(names: string[]): string {
  const uniq = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (uniq.length === 0) return "";
  if (uniq.length === 1) return `'${uniq[0]}'`;
  return uniq.map((n) => `'${n}'`).join(", ");
}

export function GlossaryDuplicateDialog({
  open,
  payload,
  busy,
  error,
  onCancel,
  onResolve
}: Props) {
  const [action, setAction] = useState<GlossaryDupAction>("merge");
  const [merged, setMerged] = useState<GlossaryFieldValues | null>(null);
  const [incomingEdit, setIncomingEdit] = useState<GlossaryFieldValues | null>(
    null
  );
  /** 수정 모드 합치기: 살릴 쪽 */
  const [survivorChoice, setSurvivorChoice] = useState<"editing" | "existing">(
    "existing"
  );

  useEffect(() => {
    if (!open || !payload) return;
    setAction("merge");
    setSurvivorChoice("existing");
    setMerged(
      payload.merge_draft ?? {
        ...payload.incoming
      }
    );
    setIncomingEdit({ ...payload.incoming });
  }, [open, payload]);

  const isEditMode = Boolean(payload?.exclude_id) && !payload?.candidate_id;

  const conflictNames = useMemo(() => {
    if (!payload) return [] as string[];
    const names = [payload.existing.term_ko];
    for (const o of payload.others) {
      if (o.existing_term_ko) names.push(o.existing_term_ko);
    }
    return Array.from(new Set(names.filter(Boolean)));
  }, [payload]);

  const editingName =
    payload?.editing_term_ko?.trim() ||
    payload?.incoming.term_ko?.trim() ||
    "편집 중인 용어";

  if (!open || !payload || !merged || !incomingEdit) return null;

  const activePayload = payload;
  const activeMerged = merged;
  const activeIncomingEdit = incomingEdit;

  const existingFields: GlossaryFieldValues = {
    term_ko: activePayload.existing.term_ko,
    term_en: activePayload.existing.term_en ?? "",
    term_zh: activePayload.existing.term_zh ?? "",
    synonyms: activePayload.existing.synonyms ?? [],
    definition: activePayload.existing.definition ?? "",
    categories: activePayload.existing.categories?.length
      ? activePayload.existing.categories
      : ["공통"]
  };

  const existingMeta = `v${activePayload.existing.version} · ${shortDate(
    activePayload.existing.updated_at
  )} · ${activePayload.existing.updated_by_name || "—"}`;

  const survivorId =
    isEditMode && action === "merge"
      ? survivorChoice === "editing"
        ? (activePayload.exclude_id as string)
        : activePayload.existing.id
      : isEditMode && action === "replace"
        ? (activePayload.exclude_id as string)
        : activePayload.existing.id;

  const willDelete: string[] = (() => {
    if (action === "keep" || action === "register") return [];
    if (action === "replace") {
      if (isEditMode) return conflictNames;
      return activePayload.others
        .map((o) => o.existing_term_ko)
        .filter(
          (n): n is string =>
            Boolean(n) && n !== activePayload.existing.term_ko
        );
    }
    // merge
    if (isEditMode) {
      return survivorChoice === "editing" ? conflictNames : [editingName];
    }
    return activePayload.others
      .map((o) => o.existing_term_ko)
      .filter(
        (n): n is string => Boolean(n) && n !== activePayload.existing.term_ko
      );
  })();

  const destructive = willDelete.length > 0;

  const actionOptions: Array<{ key: GlossaryDupAction; label: string }> = isEditMode
    ? [
        {
          key: "merge",
          label: "합치기 — 두 정의를 하나로 정리 (살릴 쪽을 고름)"
        },
        {
          key: "replace",
          label: "새 것으로 교체 — 충돌한 상대를 지우고 이 용어에 저장"
        },
        {
          key: "keep",
          label: "수정 취소 — 원래 값으로 되돌리기"
        },
        {
          key: "register",
          label: "다른 용어로 등록 — 지금 용어는 두고 새 이름으로 추가"
        }
      ]
    : [
        {
          key: "merge",
          label: "합치기 — 두 정의를 하나로 정리해 기존 용어를 갱신"
        },
        {
          key: "replace",
          label: "새 것으로 교체 — 기존 내용을 새 내용으로 덮어씀"
        },
        {
          key: "keep",
          label: "기존 것 유지 — 새로 올린 것은 폐기"
        },
        {
          key: "register",
          label: "다른 용어로 등록 — 이름을 바꿔 별개 용어로 추가"
        }
      ];

  const buttonLabel = (() => {
    if (busy) return "처리 중…";
    if (action === "merge") return "이대로 합치기";
    if (action === "replace") return "교체";
    if (action === "keep") {
      return isEditMode ? "수정 취소" : "유지";
    }
    return "등록";
  })();

  const deleteHint =
    willDelete.length > 0
      ? `${quoteNames(willDelete)}가 사전에서 삭제됩니다`
      : action === "keep" && !isEditMode
        ? "새로 올린 내용은 등록되지 않습니다"
        : action === "keep" && isEditMode
          ? "아무 용어도 삭제되지 않습니다"
          : action === "register"
            ? "아무 용어도 삭제되지 않습니다"
            : null;

  function submit() {
    if (busy) return;
    onResolve({
      action,
      merged: activeMerged,
      incoming:
        action === "register" ? activeIncomingEdit : activePayload.incoming,
      survivor_id: survivorId
    });
  }

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
            badge={isEditMode ? "수정하려는 것" : "새로 올린 것"}
            emphasize
            meta={payload.source_label || (isEditMode ? "용어 수정" : "신규")}
            fields={payload.incoming}
          />
        </div>

        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: C.line }}>
          {actionOptions.map(({ key, label }) => (
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

        {action === "merge" && isEditMode ? (
          <div className="border-t px-4 py-3" style={{ borderColor: C.line }}>
            <div className="mb-2 text-[12px] font-bold" style={{ color: C.sub }}>
              어느 쪽을 남길까요?
            </div>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  className="mt-1"
                  name="survivor-choice"
                  checked={survivorChoice === "existing"}
                  onChange={() => setSurvivorChoice("existing")}
                />
                <span>
                  사전에 있는 것 유지 — '{activePayload.existing.term_ko}'
                  <span className="block text-[11.5px]" style={{ color: C.faint }}>
                    '{editingName}' 삭제
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  className="mt-1"
                  name="survivor-choice"
                  checked={survivorChoice === "editing"}
                  onChange={() => setSurvivorChoice("editing")}
                />
                <span>
                  수정 중인 것 유지 — '{editingName}'
                  <span className="block text-[11.5px]" style={{ color: C.faint }}>
                    {quoteNames(conflictNames)} 삭제
                  </span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

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
          className="border-t px-4 py-3"
          style={{ borderColor: C.line }}
        >
          {deleteHint ? (
            <p
              className="mb-2 text-[12.5px] font-semibold"
              style={{ color: destructive ? C.warnInk : C.sub }}
            >
              {deleteHint}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded-[9px] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-50"
              style={{ background: destructive ? C.coral : C.luna }}
            >
              {buttonLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-[9px] border px-3.5 py-2 text-[13px] font-bold disabled:opacity-50"
              style={{ borderColor: C.line, color: C.sub }}
            >
              닫기
            </button>
            <span className="ml-auto text-[11px]" style={{ color: C.faint }}>
              모든 처리는 변경 이력에 남습니다
            </span>
          </div>
        </div>
        {error ? (
          <div
            className="border-t px-4 py-2.5 text-[12.5px]"
            style={{
              borderColor: C.line,
              background: C.warnBg,
              color: C.warnInk
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
