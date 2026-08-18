"use client";

import { useRef } from "react";
import { W } from "@/components/wiki/wiki-theme";

function wrapSelection(
  el: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder = ""
): string {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const value = el.value;
  const selected = value.slice(start, end) || placeholder;
  const next =
    value.slice(0, start) + before + selected + after + value.slice(end);
  return next;
}

function prefixLines(el: HTMLTextAreaElement, prefix: string): string {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const value = el.value;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const block = value.slice(from, end);
  const nextBlock = block
    .split("\n")
    .map((line, i) =>
      prefix === "1. "
        ? `${i + 1}. ${line.replace(/^\s*([0-9]+\.\s+|[-*]\s+)/, "")}`
        : `${prefix}${line.replace(/^\s*([0-9]+\.\s+|[-*]\s+)/, "")}`
    )
    .join("\n");
  return value.slice(0, from) + nextBlock + value.slice(end);
}

export function WikiSectionEditor({
  heading,
  value,
  onChange,
  onCancel,
  changeNote,
  onChangeNote,
  onSave,
  onToggleDiff,
  showDiff,
  busy,
  hint = "저장하면 루나가 바로 이 내용을 씁니다"
}: {
  heading: string;
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  changeNote: string;
  onChangeNote: (next: string) => void;
  onSave: () => void;
  onToggleDiff: () => void;
  showDiff: boolean;
  busy?: boolean;
  hint?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(fn: (el: HTMLTextAreaElement) => string) {
    const el = ref.current;
    if (!el) return;
    onChange(fn(el));
  }

  function link() {
    const el = ref.current;
    if (!el) return;
    const href = window.prompt("연결할 주소", "/wiki/");
    if (!href) return;
    onChange(wrapSelection(el, "[", `](${href})`, "이름"));
  }

  return (
    <div
      className="overflow-hidden rounded-[11px] border"
      style={{ borderColor: W.luna }}
    >
      <div
        className="flex gap-2 px-[13px] py-[9px] text-[11.5px] font-semibold"
        style={{ background: W.lunaSoft, color: W.lunaInk }}
      >
        <span>{heading}</span>
        <button
          type="button"
          className="ml-auto"
          style={{ color: W.sub }}
          onClick={onCancel}
        >
          ✕ 취소
        </button>
      </div>
      <div
        className="flex gap-[3px] border-b px-[13px] py-[7px]"
        style={{ borderColor: W.line2, background: "#FBFBFC" }}
      >
        <Tool onClick={() => apply((el) => wrapSelection(el, "**", "**"))}>
          <b>B</b>
        </Tool>
        <Tool onClick={() => apply((el) => wrapSelection(el, "*", "*"))}>
          <i>I</i>
        </Tool>
        <Tool onClick={() => apply((el) => prefixLines(el, "- "))}>• 목록</Tool>
        <Tool onClick={() => apply((el) => prefixLines(el, "1. "))}>1. 번호</Tool>
        <Tool onClick={link}>🔗 연결</Tool>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[110px] w-full resize-y bg-[#FCFCFD] px-[13px] py-[13px] text-[13px] leading-[1.9] outline-none"
        style={{ color: "#2a2c31" }}
      />
      <div className="border-t px-[13px] py-[11px]" style={{ borderColor: W.line }}>
        <p className="mb-1 text-[11px]" style={{ color: W.sub }}>
          무엇을 왜 바꾸셨나요?{" "}
          <span style={{ color: W.faint }}>이력에 남습니다 · 안 적어도 됩니다</span>
        </p>
        <input
          value={changeNote}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="예) 협력사 견적 원본 첨부 금지를 추가"
          className="mb-2.5 w-full rounded-lg border px-[11px] py-2 text-[12px] outline-none"
          style={{ borderColor: W.line, color: W.ink }}
        />
        <div className="flex flex-wrap items-center gap-[7px]">
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="rounded-[9px] px-3 py-[7px] text-[11.5px] font-semibold text-white disabled:opacity-40"
            style={{ background: W.luna }}
          >
            저장
          </button>
          <button
            type="button"
            onClick={onToggleDiff}
            className="rounded-[9px] border px-3 py-[7px] text-[11.5px] font-semibold"
            style={{ borderColor: W.line, color: "#33363c" }}
          >
            {showDiff ? "편집으로" : "바뀐 곳 보기"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[9px] border px-3 py-[7px] text-[11.5px] font-semibold"
            style={{ borderColor: W.line, color: "#33363c" }}
          >
            취소
          </button>
          <span className="ml-auto text-[10.5px]" style={{ color: W.faint }}>
            {hint}
          </span>
        </div>
      </div>
    </div>
  );
}

function Tool({
  children,
  onClick
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-[3px] text-[11px] hover:bg-[#f1f2f5]"
      style={{ color: W.sub }}
    >
      {children}
    </button>
  );
}
