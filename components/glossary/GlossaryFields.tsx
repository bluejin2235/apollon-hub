"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { toggleCategory } from "@/lib/glossary/categories";
import { normalizeSynonyms, splitSynonymInput } from "@/lib/glossary/synonyms";
import {
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type GlossaryFieldValues
} from "@/lib/glossary/types";

const C = {
  line: "#e7e8ec",
  ink: "#1c1d21",
  faint: "#9aa0a8",
  chip: "#f1f2f5",
  luna: "#534AB7",
  candInk: "#993C1D",
  candSoft: "#FAECE7"
};

type GlossaryFieldsProps = {
  value: GlossaryFieldValues;
  onChange: (next: GlossaryFieldValues) => void;
  /** 후보 카드: 용어명 비었을 때 강조 */
  highlightMissingTerm?: boolean;
  /** 후보 카드: 제목→정의 이동 안내 */
  movedFromTitle?: boolean;
  changeNote?: string;
  onChangeNote?: (note: string) => void;
  evidence?: string | null;
};

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[11px]" style={{ color: C.faint }}>
      {children}
    </div>
  );
}

export function GlossaryCategoryToggles({
  value,
  onChange
}: {
  value: GlossaryCategory[];
  onChange: (next: GlossaryCategory[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {GLOSSARY_CATEGORIES.map((cat) => {
        const on = value.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(toggleCategory(value, cat))}
            className="rounded-[20px] border px-2.5 py-1 text-[11.5px] font-bold"
            style={
              on
                ? { background: C.luna, color: "#fff", borderColor: C.luna }
                : { background: C.chip, color: "#6b6f76", borderColor: C.line }
            }
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}

export function SynonymTagInput({
  value,
  onChange
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = splitSynonymInput(raw);
    if (parts.length === 0) return;
    onChange(normalizeSynonyms([...value, ...parts]));
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className="mb-2.5 flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5"
      style={{ borderColor: C.line }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-[20px] px-2 py-0.5 text-[12px] font-bold"
          style={{ background: C.chip, color: C.ink }}
        >
          {tag}
          <button
            type="button"
            aria-label={`${tag} 제거`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-[12px] leading-none"
            style={{ color: C.faint }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",") || v.includes("，") || v.includes("、")) {
            commit(v);
            return;
          }
          setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        placeholder={value.length ? "" : "Enter 또는 쉼표로 추가"}
        className="min-w-[120px] flex-1 bg-transparent py-1 text-[13px] outline-none placeholder:text-slate-400"
        style={{ color: C.ink }}
      />
    </div>
  );
}

/** 한국어 / ENGLISH / 中文(볼드) / 동의어 / 정의 / 분류 — 세 화면 공용 */
export function GlossaryFields({
  value,
  onChange,
  highlightMissingTerm,
  movedFromTitle,
  changeNote,
  onChangeNote,
  evidence
}: GlossaryFieldsProps) {
  const termMissing = !value.term_ko.trim();
  const termBorder =
    highlightMissingTerm && termMissing ? "#D85A30" : C.line;

  return (
    <div>
      {movedFromTitle && termMissing ? (
        <div
          className="mb-2.5 rounded-[9px] px-3 py-2 text-[12.5px] leading-snug"
          style={{ background: C.candSoft, color: C.candInk }}
        >
          정의 문장이 용어명 자리에 들어와 있어요. 용어명을 채워 주세요.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-3">
        <div>
          <FieldLabel>한국어</FieldLabel>
          <input
            value={value.term_ko}
            placeholder="용어명"
            onChange={(e) => onChange({ ...value, term_ko: e.target.value })}
            className="mb-2.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
            style={{ borderColor: termBorder, color: C.ink }}
          />
        </div>
        <div>
          <FieldLabel>ENGLISH</FieldLabel>
          <input
            value={value.term_en}
            placeholder="English"
            onChange={(e) => onChange({ ...value, term_en: e.target.value })}
            className="mb-2.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
            style={{ borderColor: C.line, color: C.ink }}
          />
        </div>
        <div>
          <FieldLabel>中文</FieldLabel>
          <input
            value={value.term_zh}
            placeholder="中文"
            onChange={(e) => onChange({ ...value, term_zh: e.target.value })}
            className="mb-2.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] font-bold outline-none focus:border-[#d9d2ff]"
            style={{ borderColor: C.line, color: C.ink }}
          />
        </div>
      </div>

      <FieldLabel>동의어</FieldLabel>
      <SynonymTagInput
        value={value.synonyms}
        onChange={(synonyms) => onChange({ ...value, synonyms })}
      />

      <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[11px]" style={{ color: C.faint }}>
          정의
        </span>
        {movedFromTitle ? (
          <span className="text-[11px]" style={{ color: C.candInk }}>
            · 원래 제목에 있던 문장을 옮겨 왔어요
          </span>
        ) : null}
      </div>
      <textarea
        value={value.definition}
        onChange={(e) => onChange({ ...value, definition: e.target.value })}
        placeholder="정의"
        className="mb-2.5 h-[120px] w-full resize-y rounded-lg border bg-white px-2.5 py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
        style={{ borderColor: C.line, color: C.ink }}
      />

      <FieldLabel>분류 (최소 1개)</FieldLabel>
      <GlossaryCategoryToggles
        value={value.categories}
        onChange={(categories) => onChange({ ...value, categories })}
      />

      {onChangeNote ? (
        <div className="mt-2.5">
          <FieldLabel>무엇을 왜 바꿨나요</FieldLabel>
          <input
            value={changeNote ?? ""}
            placeholder="예: 오타 수정 · 동의어 추가"
            onChange={(e) => onChangeNote(e.target.value)}
            className="mb-2.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
            style={{ borderColor: C.line, color: C.ink }}
          />
        </div>
      ) : null}

      {evidence ? (
        <div className="mt-2.5 text-[12px]" style={{ color: "#6b6f76" }}>
          근거: {evidence.replace(/^근거:\s*/, "")}
        </div>
      ) : null}
    </div>
  );
}
