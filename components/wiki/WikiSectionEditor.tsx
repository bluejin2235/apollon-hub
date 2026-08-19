"use client";

import { WikiBodyEditor } from "@/components/wiki/WikiBodyEditor";
import { W } from "@/components/wiki/wiki-theme";

export function WikiSectionEditor({
  heading,
  headingValue,
  onHeadingChange,
  value,
  onChange,
  onCancel,
  changeNote,
  onChangeNote,
  onSave,
  onToggleDiff,
  showDiff,
  busy,
  slug,
  hint = "저장하면 루나가 바로 이 내용을 씁니다"
}: {
  heading: string;
  headingValue?: string;
  onHeadingChange?: (next: string) => void;
  value: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  changeNote: string;
  onChangeNote: (next: string) => void;
  onSave: () => void;
  onToggleDiff: () => void;
  showDiff: boolean;
  busy?: boolean;
  slug?: string;
  hint?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-[11px] border"
      style={{ borderColor: W.luna }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 text-[11.5px] font-semibold"
        style={{ background: W.lunaSoft, color: W.lunaInk }}
      >
        <span>절 제목</span>
        {onHeadingChange ? (
          <input
            value={headingValue ?? heading}
            onChange={(e) => onHeadingChange(e.target.value)}
            className="rounded-md border bg-white px-2 py-[3px] text-[12px] font-bold outline-none"
            style={{ borderColor: "#CFC9EC", width: 180 }}
          />
        ) : (
          <span>{heading}</span>
        )}
        <button
          type="button"
          className="ml-auto"
          style={{ color: W.sub }}
          onClick={onCancel}
        >
          ✕ 취소
        </button>
      </div>
      <WikiBodyEditor value={value} onChange={onChange} slug={slug ?? "misc"} />
      <div className="border-t px-[13px] py-[11px]" style={{ borderColor: W.line }}>
        <p className="mb-1 text-[11px]" style={{ color: W.sub }}>
          무엇을 왜 바꾸셨나요?{" "}
          <span style={{ color: W.faint }}>이력에 남습니다</span>
        </p>
        <input
          value={changeNote}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="예) 유튜브 영상 추가"
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
