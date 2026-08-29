"use client";

import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
};

function run(command: string, arg?: string) {
  document.execCommand(command, false, arg);
}

export function InsightTextEditor({ value, onChange, onBlur }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) {
      el.innerHTML = value || "<p></p>";
    }
  }, [value]);

  function emit() {
    onChange(ref.current?.innerHTML ?? "");
  }

  function link() {
    const href = window.prompt("링크 주소", "https://");
    if (!href?.trim()) return;
    run("createLink", href.trim());
    emit();
  }

  return (
    <div className="overflow-hidden rounded-[7px] border border-[#dde1e6] bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-[#f8f9fb] px-2 py-1.5 text-[11.5px] text-slate-600">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={() => { run("formatBlock", "h2"); emit(); }}>
          H2
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={() => { run("formatBlock", "h3"); emit(); }}>
          H3
        </button>
        <span className="mx-1 h-3 w-px bg-slate-200" />
        <button type="button" className="rounded px-1.5 py-0.5 font-bold hover:bg-white" onClick={() => { run("bold"); emit(); }}>
          B
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 italic hover:bg-white" onClick={() => { run("italic"); emit(); }}>
          I
        </button>
        <span className="mx-1 h-3 w-px bg-slate-200" />
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={() => { run("insertUnorderedList"); emit(); }}>
          • 목록
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={() => { run("insertOrderedList"); emit(); }}>
          1. 번호
        </button>
        <span className="mx-1 h-3 w-px bg-slate-200" />
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={link}>
          링크
        </button>
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-white" onClick={() => { run("undo"); emit(); }}>
          되돌리기
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="min-h-[120px] px-3 py-2 text-[12.5px] leading-relaxed text-[#3a4049] outline-none [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-1"
        onInput={emit}
        onBlur={onBlur}
      />
    </div>
  );
}
