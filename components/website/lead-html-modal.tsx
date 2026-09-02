"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  LEAD_COLORS,
  leadCharCount,
  leadToEditorHtml,
  sanitizeLeadHtml
} from "@/lib/website/lead-html";

const KO_LIMIT = 300;
const EN_LIMIT = 600;

type Pane = "ko" | "en";

type Props = {
  open: boolean;
  subtitle: string;
  ko: string;
  en: string;
  onCancel: () => void;
  onSave: (next: { ko: string; en: string }) => void;
};

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function LeadHtmlModal({ open, subtitle, ko, en, onCancel, onSave }: Props) {
  const [mounted, setMounted] = useState(false);
  const koRef = useRef<HTMLDivElement>(null);
  const enRef = useRef<HTMLDivElement>(null);
  const active = useRef<Pane>("ko");
  const source = useRef({ ko, en });
  source.current = { ko, en };
  const [koCount, setKoCount] = useState(0);
  const [enCount, setEnCount] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return;
    const { ko: koSrc, en: enSrc } = source.current;
    const koEl = koRef.current;
    const enEl = enRef.current;
    if (koEl) koEl.innerHTML = leadToEditorHtml(koSrc);
    if (enEl) enEl.innerHTML = leadToEditorHtml(enSrc);
    setKoCount(leadCharCount(koSrc));
    setEnCount(leadCharCount(enSrc));
    try {
      document.execCommand("defaultParagraphSeparator", false, "div");
    } catch {
      /* ignore */
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  function read(pane: Pane): string {
    const el = pane === "ko" ? koRef.current : enRef.current;
    return sanitizeLeadHtml(el?.innerHTML ?? "");
  }

  function emit() {
    setKoCount(leadCharCount(read("ko")));
    setEnCount(leadCharCount(read("en")));
  }

  function focusActive() {
    const el = active.current === "ko" ? koRef.current : enRef.current;
    el?.focus();
  }

  function tool(command: string, value?: string) {
    focusActive();
    run(command, value);
    emit();
  }

  function insertBreak() {
    focusActive();
    const ok = document.execCommand("insertParagraph");
    if (!ok) run("insertHTML", "<div><br></div>");
    emit();
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const insert = html ? sanitizeLeadHtml(html) : leadToEditorHtml(text);
    run("insertHTML", insert || "");
    emit();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="wa">
    <div className="lead-ov">
      <div className="lead-mw">
        <div className="lead-mwh">
          <div>
            <b>기본 설명</b>
            <span className="lead-sub">{subtitle}</span>
          </div>
          <button type="button" className="xb" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="lead-tb" onMouseDown={(event) => event.preventDefault()}>
          <button type="button" title="굵게" onClick={() => tool("bold")}>
            <b>B</b>
          </button>
          <button type="button" title="기울임" onClick={() => tool("italic")}>
            <i>I</i>
          </button>
          <button type="button" title="밑줄" className="lead-u" onClick={() => tool("underline")}>
            U
          </button>
          <span className="lead-sep" />
          <div className="lead-cl">
            {LEAD_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                title="글자 색"
                className={`lead-swatch lead-swatch-${color.slice(1)}`}
                onClick={() => tool("foreColor", color)}
              />
            ))}
          </div>
          <span className="lead-sep" />
          <button type="button" title="줄바꿈" onClick={insertBreak}>
            ↵
          </button>
          <button type="button" title="목록" onClick={() => tool("insertUnorderedList")}>
            ≡
          </button>
          <button type="button" title="서식 지우기" onClick={() => tool("removeFormat")}>
            ⌫
          </button>
        </div>
        <div className="lead-mwb">
          <div className="lead-pane">
            <div className="lead-ph2">
              <span className="lg">국문</span>
              <span className={koCount > KO_LIMIT ? "lead-cc is-over" : "lead-cc"}>
                {koCount} / {KO_LIMIT}
              </span>
            </div>
            <div
              ref={koRef}
              className="lead-ed"
              contentEditable
              suppressContentEditableWarning
              onFocus={() => {
                active.current = "ko";
              }}
              onInput={emit}
              onPaste={onPaste}
              onDrop={onDrop}
              onDragOver={(event) => event.preventDefault()}
            />
          </div>
          <div className="lead-pane">
            <div className="lead-ph2">
              <span className="lg">영문</span>
              <span className={enCount > EN_LIMIT ? "lead-cc is-over" : "lead-cc"}>
                {enCount} / {EN_LIMIT}
              </span>
            </div>
            <div
              ref={enRef}
              className="lead-ed"
              contentEditable
              suppressContentEditableWarning
              onFocus={() => {
                active.current = "en";
              }}
              onInput={emit}
              onPaste={onPaste}
              onDrop={onDrop}
              onDragOver={(event) => event.preventDefault()}
            />
          </div>
        </div>
        <div className="lead-mwf">
          <span className="hint">이미지는 넣을 수 없습니다. 아래 블록에서 넣으세요</span>
          <div className="lead-btns">
            <button type="button" className="btn" onClick={onCancel}>
              취소
            </button>
            <button
              type="button"
              className="btn acc"
              onClick={() => onSave({ ko: read("ko"), en: read("en") })}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>,
    document.body
  );
}

export { KO_LIMIT as LEAD_KO_LIMIT, EN_LIMIT as LEAD_EN_LIMIT };
