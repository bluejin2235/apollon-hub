"use client";

import {
  useEffect,
  useRef,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode
} from "react";
import { showToast } from "@/components/website/toast";
import { LEAD_COLORS } from "@/lib/website/lead-html";

export type RichTextField = {
  id: string;
  label?: string;
  extra?: ReactNode;
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
};

/** 공개 화면마다 폭·문단 간격이 다르다. 쓰는 쪽이 자기 값을 고른다. */
export type RichTextSurface = "work-lead" | "insight-body";

/** 공개 화면 실측(1920) 기준 기본값. prop 으로 덮어쓸 수 있다. */
export const RICH_TEXT_SURFACE_DEFAULTS: Record<
  RichTextSurface,
  { fontSize: string; lineHeight: string; contentWidth: number }
> = {
  /* 팝업만 축소: 공개 20/30·p 831.4 → 15px · 831.4×15/20=624 */
  "work-lead": { fontSize: "15px", lineHeight: "23px", contentWidth: 624 },
  /* 팝업만 축소: 15px · 줄바꿈 맞추려 1312×15/20=984 */
  "insight-body": { fontSize: "15px", lineHeight: "23px", contentWidth: 984 }
};

type Props = {
  fields: RichTextField[];
  sanitize: (html: string) => string;
  toEditorHtml: (text: string) => string;
  /** 워크 기본 설명 · 인사이트 본문 — 문단 간격 클래스 */
  surface: RichTextSurface;
  /** 공개 화면 글자 크기. 없으면 surface 기본값 */
  fontSize?: string;
  /** 공개 화면 줄 간격. 없으면 surface 기본값 */
  lineHeight?: string;
  /** 공개 화면 본문 칸 폭(px). 없으면 surface 기본값 */
  contentWidth?: number;
};

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

/**
 * 글 편집기 하나. 워크 기본 설명 · 인사이트 본문이 같이 씁니다.
 * 도구는 공유하고, 크기·폭·문단 간격은 surface / prop 으로 나눕니다.
 */
export function RichTextEditor({
  fields,
  sanitize,
  toEditorHtml,
  surface,
  fontSize,
  lineHeight,
  contentWidth
}: Props) {
  const defaults = RICH_TEXT_SURFACE_DEFAULTS[surface];
  const size = fontSize ?? defaults.fontSize;
  const leading = lineHeight ?? defaults.lineHeight;
  const width = contentWidth ?? defaults.contentWidth;

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeId = useRef(fields[0]?.id ?? "");
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* ignore */
    }
  }, []);

  const valueKey = fields.map((field) => `${field.id}:${field.value}`).join("\0");

  useEffect(() => {
    for (const field of fieldsRef.current) {
      const el = refs.current[field.id];
      if (!el) continue;
      const next = field.value || "<p><br></p>";
      if (el.innerHTML !== next) el.innerHTML = next;
    }
  }, [valueKey]);

  function read(id: string): string {
    return refs.current[id]?.innerHTML ?? "";
  }

  function emit(id: string) {
    const field = fieldsRef.current.find((item) => item.id === id);
    field?.onChange(read(id));
  }

  function focusActive() {
    refs.current[activeId.current]?.focus();
  }

  function tool(command: string, value?: string) {
    focusActive();
    run(command, value);
    emit(activeId.current);
  }

  function insertBreak() {
    focusActive();
    const ok = document.execCommand("insertParagraph");
    if (!ok) run("insertHTML", "<p><br></p>");
    emit(activeId.current);
  }

  function link() {
    focusActive();
    const href = window.prompt("링크 주소", "https://");
    if (!href?.trim()) return;
    run("createLink", href.trim());
    emit(activeId.current);
  }

  async function pastePlain() {
    focusActive();
    try {
      const text = await navigator.clipboard.readText();
      run("insertHTML", toEditorHtml(text) || "");
      emit(activeId.current);
      showToast({ message: "서식을 걸러 넣었습니다", tone: "ok" });
    } catch {
      showToast({
        message: "클립보드를 읽을 수 없습니다. Ctrl+V 로 붙여 넣으세요.",
        tone: "warn"
      });
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const insert = html ? sanitize(html) : toEditorHtml(text);
    run("insertHTML", insert || "");
    emit(id);
    showToast({ message: "서식을 걸러 넣었습니다", tone: "ok" });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  // 크기·폭은 CSS .rte-ed--{surface}. 인라인 style 금지.
  void size;
  void leading;
  void width;

  return (
    <div className="rte">
      <div className="rte-tb" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" title="소제목" onClick={() => tool("formatBlock", "h2")}>
          H2
        </button>
        <button type="button" title="작은 제목" onClick={() => tool("formatBlock", "h3")}>
          H3
        </button>
        <span className="rte-sep" />
        <button type="button" title="굵게" onClick={() => tool("bold")}>
          <b>B</b>
        </button>
        <button type="button" title="기울임" onClick={() => tool("italic")}>
          <i>I</i>
        </button>
        <button type="button" title="밑줄" className="rte-u" onClick={() => tool("underline")}>
          U
        </button>
        <span className="rte-sep" />
        <div className="rte-cl">
          {LEAD_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title="글자 색"
              className={`rte-swatch rte-swatch-${color.slice(1)}`}
              onClick={() => tool("foreColor", color)}
            />
          ))}
        </div>
        <span className="rte-sep" />
        <button type="button" title="줄바꿈" onClick={insertBreak}>
          ↵
        </button>
        <button type="button" title="목록" onClick={() => tool("insertUnorderedList")}>
          ≡
        </button>
        <button type="button" title="번호 목록" onClick={() => tool("insertOrderedList")}>
          1.
        </button>
        <button type="button" title="링크" onClick={link}>
          링크
        </button>
        <button type="button" title="서식 지우기" onClick={() => tool("removeFormat")}>
          ⌫
        </button>
        <button type="button" title="되돌리기" onClick={() => tool("undo")}>
          ↩
        </button>
        <span className="rte-sep" />
        <button type="button" title="글자만 붙여넣기" onClick={() => void pastePlain()}>
          글자만
        </button>
      </div>
      <div className={fields.length > 1 ? "rte-panes" : undefined}>
        {fields.map((field) => (
          <div key={field.id} className="rte-pane">
            {field.label || field.extra ? (
              <div className="rte-ph">
                {field.label ? <span className="lg">{field.label}</span> : <span />}
                {field.extra}
              </div>
            ) : null}
            <div className="rte-scroll">
              <div
                ref={(el) => {
                  refs.current[field.id] = el;
                }}
                className={`rte-ed rte-ed--${surface}`}
                contentEditable
                suppressContentEditableWarning
                onFocus={() => {
                  activeId.current = field.id;
                }}
                onInput={() => emit(field.id)}
                onBlur={field.onBlur}
                onPaste={(event) => onPaste(event, field.id)}
                onDrop={onDrop}
                onDragOver={(event) => event.preventDefault()}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
