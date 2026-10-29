"use client";

import {
  useEffect,
  useRef,
  useState,
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

/** 공개 화면 실측(1920) 기준. 폭은 고정하지 않고 칸의 cqw 로 맞춘다. */
export const RICH_TEXT_SURFACE_DEFAULTS: Record<
  RichTextSurface,
  { fontSize: string; lineHeight: string; contentWidth: number }
> = {
  /* 공개 831.4px · 20px = 2.4056cqw. 11px 하한은 칸 457px 부터 */
  "work-lead": {
    fontSize: "clamp(11px, 2.4056cqw, 20px)",
    lineHeight: "1.5",
    contentWidth: 831.4
  },
  /* 공개 1312px · 20px = 1.5244cqw. 11px 하한은 칸 722px 부터 */
  "insight-body": {
    fontSize: "clamp(11px, 1.5244cqw, 20px)",
    lineHeight: "1.5",
    contentWidth: 1312
  }
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
  /** 이미지·영상 넣기. 문의 게시판만 켠다 */
  allowMedia?: boolean;
  onUploadFile?: (file: File) => Promise<string | null>;
};

function run(command: string, value?: string) {
  document.execCommand(command, false, value);
}

const INDENT_CLASSES = ["in-1", "in-2", "in-3", "in-4"] as const;
const SIZE_CLASSES = ["sz-lg", "sz-sm"] as const;

function indentLevel(el: HTMLElement): number {
  const index = INDENT_CLASSES.findIndex((name) => el.classList.contains(name));
  return index < 0 ? 0 : index + 1;
}

function setIndentClass(el: HTMLElement, level: number) {
  for (const name of INDENT_CLASSES) el.classList.remove(name);
  if (level >= 1 && level <= 4) el.classList.add(`in-${level}`);
}

function blocksInSelection(root: HTMLElement): HTMLElement[] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  const hits = Array.from(root.querySelectorAll<HTMLElement>("p, h2, h3")).filter((block) => {
    try {
      return range.intersectsNode(block);
    } catch {
      return false;
    }
  });
  if (hits.length > 0) return hits;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const block = el?.closest("p, h2, h3");
  if (block instanceof HTMLElement && root.contains(block)) return [block];
  return [];
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
  contentWidth,
  allowMedia = false,
  onUploadFile
}: Props) {
  const defaults = RICH_TEXT_SURFACE_DEFAULTS[surface];
  const size = fontSize ?? defaults.fontSize;
  const leading = lineHeight ?? defaults.lineHeight;
  const width = contentWidth ?? defaults.contentWidth;

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const activeId = useRef(fields[0]?.id ?? "");
  const [menu, setMenu] = useState<null | "block" | "size">(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const uploadRef = useRef(onUploadFile);
  uploadRef.current = onUploadFile;

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      const openMenu = toolsRef.current?.querySelector(".rte-dd.is-open");
      if (event.target instanceof Node && openMenu?.contains(event.target)) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

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

  function editBlocks(fn: (root: HTMLElement, blocks: HTMLElement[]) => void) {
    focusActive();
    const root = refs.current[activeId.current];
    if (!root) return;
    fn(root, blocksInSelection(root));
    emit(activeId.current);
  }

  function setParagraphKind(kind: "p" | "h2" | "h2-big" | "h3") {
    editBlocks((root, blocks) => {
      const saved = blocks.map((block) => ({
        indent: indentLevel(block),
        size: SIZE_CLASSES.find((name) => block.classList.contains(name)) ?? null
      }));
      const tag = kind === "h3" ? "h3" : kind === "p" ? "p" : "h2";
      run("formatBlock", tag);
      const next = blocksInSelection(root);
      const targets = next.length > 0 ? next : blocks;
      targets.forEach((block, index) => {
        const prior = saved[index] ?? saved[0];
        block.classList.remove("is-big", ...SIZE_CLASSES);
        if (kind === "h2-big") block.classList.add("is-big");
        if (kind === "p" && prior?.size) block.classList.add(prior.size);
        setIndentClass(block, prior?.indent ?? 0);
      });
    });
    setMenu(null);
  }

  function setTextSize(size: "lg" | "md" | "sm") {
    editBlocks((_root, blocks) => {
      for (const block of blocks) {
        if (block.tagName !== "P") continue;
        block.classList.remove(...SIZE_CLASSES);
        if (size === "lg") block.classList.add("sz-lg");
        if (size === "sm") block.classList.add("sz-sm");
      }
    });
    setMenu(null);
  }

  function shiftIndent(delta: number) {
    editBlocks((_root, blocks) => {
      for (const block of blocks) {
        const next = Math.min(4, Math.max(0, indentLevel(block) + delta));
        setIndentClass(block, next);
      }
    });
  }

  function insertMediaHtml(url: string, kind: "image" | "video") {
    focusActive();
    if (kind === "video") {
      run("insertHTML", `<p><video src="${url}" controls></video></p>`);
    } else {
      run("insertHTML", `<p><img src="${url}" alt=""></p>`);
    }
    emit(activeId.current);
  }

  async function uploadAndInsert(file: File) {
    const upload = uploadRef.current;
    if (!upload) return;
    try {
      const url = await upload(file);
      if (!url) {
        showToast({ message: "파일을 올리지 못했습니다", tone: "error" });
        return;
      }
      const kind = file.type.startsWith("video/") ? "video" : "image";
      insertMediaHtml(url, kind);
    } catch {
      showToast({ message: "파일을 올리지 못했습니다", tone: "error" });
    }
  }

  function pickMedia(kind: "image" | "video") {
    if (kind === "video") {
      const href = window.prompt("영상 주소", "https://");
      if (href?.trim()) {
        insertMediaHtml(href.trim(), "video");
        return;
      }
    }
    fileRef.current?.click();
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
    const files = Array.from(event.clipboardData.files ?? []).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );
    if (allowMedia && files.length > 0 && uploadRef.current) {
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        for (const file of files) {
          await uploadAndInsert(file);
        }
      })();
      return;
    }
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
    if (!allowMedia || !uploadRef.current) return;
    const files = Array.from(event.dataTransfer.files ?? []).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );
    if (files.length === 0) return;
    void (async () => {
      for (const file of files) {
        await uploadAndInsert(file);
      }
    })();
  }

  // 글자 크기는 CSS .rte-ed--{surface} 의 cqw. 인라인 style · 폭 고정 금지.
  void size;
  void leading;
  void width;

  return (
    <div className="rte">
      <div
        ref={toolsRef}
        className="rte-tb"
        onMouseDown={(event) => event.preventDefault()}
      >
        {surface === "insight-body" ? (
          <>
            <div className={menu === "block" ? "rte-dd is-open" : "rte-dd"}>
              <button
                type="button"
                className="rte-dd-btn"
                title="문단"
                aria-expanded={menu === "block"}
                onClick={() => setMenu((current) => (current === "block" ? null : "block"))}
              >
                문단
              </button>
              {menu === "block" ? (
                <div className="rte-dd-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => setParagraphKind("p")}>
                    본문
                  </button>
                  <button type="button" role="menuitem" onClick={() => setParagraphKind("h2-big")}>
                    큰 제목
                  </button>
                  <button type="button" role="menuitem" onClick={() => setParagraphKind("h2")}>
                    소제목
                  </button>
                  <button type="button" role="menuitem" onClick={() => setParagraphKind("h3")}>
                    작은 제목
                  </button>
                </div>
              ) : null}
            </div>
            <div className={menu === "size" ? "rte-dd is-open" : "rte-dd"}>
              <button
                type="button"
                className="rte-dd-btn"
                title="본문 글자 크기"
                aria-expanded={menu === "size"}
                onClick={() => setMenu((current) => (current === "size" ? null : "size"))}
              >
                크기
              </button>
              {menu === "size" ? (
                <div className="rte-dd-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => setTextSize("lg")}>
                    크게
                  </button>
                  <button type="button" role="menuitem" onClick={() => setTextSize("md")}>
                    보통
                  </button>
                  <button type="button" role="menuitem" onClick={() => setTextSize("sm")}>
                    작게
                  </button>
                </div>
              ) : null}
            </div>
            <span className="rte-sep" />
            <button type="button" title="윗첨자" onClick={() => tool("superscript")}>
              x<sup>2</sup>
            </button>
            <button type="button" title="아랫첨자" onClick={() => tool("subscript")}>
              x<sub>2</sub>
            </button>
            <button type="button" title="내어쓰기" onClick={() => shiftIndent(-1)}>
              ⇤
            </button>
            <button type="button" title="들여쓰기" onClick={() => shiftIndent(1)}>
              ⇥
            </button>
            <span className="rte-sep" />
          </>
        ) : (
          <>
            <button type="button" title="소제목" onClick={() => tool("formatBlock", "h2")}>
              H2
            </button>
            <button type="button" title="작은 제목" onClick={() => tool("formatBlock", "h3")}>
              H3
            </button>
            <span className="rte-sep" />
          </>
        )}
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
        {allowMedia ? (
          <>
            <span className="rte-sep" />
            <button type="button" title="이미지" onClick={() => pickMedia("image")}>
              🖼 이미지
            </button>
            <button type="button" title="영상" onClick={() => pickMedia("video")}>
              🎬 영상
            </button>
          </>
        ) : null}
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
      {allowMedia ? (
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm"
          className="rte-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadAndInsert(file);
          }}
        />
      ) : null}
    </div>
  );
}
