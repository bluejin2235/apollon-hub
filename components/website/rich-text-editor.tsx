"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode
} from "react";
import { showToast } from "@/components/website/toast";
import {
  insightToEditorHtml,
  normalizeInsightColor,
  sanitizeInsightHtml
} from "@/lib/website/insight-html";
import { issueToEditorHtml, sanitizeIssueHtml } from "@/lib/issues/html";
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
  /** 워크 기본 설명 · 인사이트 본문 — 문단 간격 클래스 */
  surface: RichTextSurface;
  /** 공개 화면 글자 크기. 없으면 surface 기본값 */
  fontSize?: string;
  /** 공개 화면 줄 간격. 없으면 surface 기본값 */
  lineHeight?: string;
  /** 공개 화면 본문 칸 폭(px). 없으면 surface 기본값 */
  contentWidth?: number;
  /** 표준 + 이미지·영상. 이슈만 켠다 */
  allowMedia?: boolean;
  onUploadFile?: (file: File) => Promise<string | null>;
  sanitize?: (html: string) => string;
  toEditorHtml?: (text: string) => string;
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

const COLOR_TITLES: Record<(typeof LEAD_COLORS)[number], string> = {
  "#0f172a": "먹색",
  "#b0231e": "빨강",
  "#a35a08": "주황",
  "#0f7a45": "초록",
  "#534ab7": "보라"
};

/** 목업 docs/mockups/palette.html 글꼴 색 32색. 8열 4줄 */
const FONT_COLORS = [
  "#ffffff",
  "#f1f5f9",
  "#cbd5e1",
  "#94a3b8",
  "#64748b",
  "#475569",
  "#1e293b",
  "#000000",
  "#fecaca",
  "#fed7aa",
  "#fef08a",
  "#bbf7d0",
  "#a5f3fc",
  "#bfdbfe",
  "#ddd6fe",
  "#fbcfe8",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#991b1b",
  "#9a3412",
  "#854d0e",
  "#166534",
  "#155e75",
  "#1e40af",
  "#5b21b6",
  "#9d174d"
] as const;

type BlockKind = "p" | "h2" | "h2-big" | "h3";
type TextSize = "lg" | "md" | "sm";

function blockKindOf(el: HTMLElement): BlockKind | null {
  const tag = el.tagName;
  if (tag === "P") return "p";
  if (tag === "H3") return "h3";
  if (tag === "H2") return el.classList.contains("is-big") ? "h2-big" : "h2";
  return null;
}

function textSizeOf(el: HTMLElement): TextSize {
  if (el.classList.contains("sz-lg")) return "lg";
  if (el.classList.contains("sz-sm")) return "sm";
  return "md";
}

function caretBlock(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const node = sel.anchorNode;
  if (!node || !root.contains(node)) return null;
  const el = node instanceof Element ? node : node.parentElement;
  const block = el?.closest("p, h2, h3");
  if (block instanceof HTMLElement && root.contains(block)) return block;
  return null;
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
 * 표준 글 편집기. 도구 구성은 화면마다 같다.
 * 화면별 차이는 이미지·영상 등 더하는 것만.
 */
export function RichTextEditor({
  fields,
  surface,
  fontSize,
  lineHeight,
  contentWidth,
  allowMedia = false,
  onUploadFile,
  sanitize,
  toEditorHtml
}: Props) {
  const sanitizeHtml = sanitize ?? (allowMedia ? sanitizeIssueHtml : sanitizeInsightHtml);
  const toEditor = toEditorHtml ?? (allowMedia ? issueToEditorHtml : insightToEditorHtml);
  const defaults = RICH_TEXT_SURFACE_DEFAULTS[surface];
  const size = fontSize ?? defaults.fontSize;
  const leading = lineHeight ?? defaults.lineHeight;
  const width = contentWidth ?? defaults.contentWidth;

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const paletteWrapRef = useRef<HTMLDivElement | null>(null);
  const palettePopRef = useRef<HTMLDivElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const activeId = useRef(fields[0]?.id ?? "");
  const [blockKind, setBlockKind] = useState<BlockKind | null>(null);
  const [textSize, setTextSizeState] = useState<TextSize>("md");
  const [sizeEnabled, setSizeEnabled] = useState(true);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const uploadRef = useRef(onUploadFile);
  uploadRef.current = onUploadFile;
  const sanitizeRef = useRef(sanitizeHtml);
  sanitizeRef.current = sanitizeHtml;
  const toEditorRef = useRef(toEditor);
  toEditorRef.current = toEditor;

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* ignore */
    }
  }, []);

  function refreshBlockUi() {
    const root = refs.current[activeId.current];
    const block = root ? caretBlock(root) : null;
    const kind = block ? blockKindOf(block) : null;
    setBlockKind(kind);
    setSizeEnabled(kind === "p");
    setTextSizeState(block && kind === "p" ? textSizeOf(block) : "md");
    try {
      const raw = document.queryCommandValue("foreColor") ?? "";
      setActiveColor(normalizeInsightColor(raw));
    } catch {
      setActiveColor(null);
    }
  }

  useEffect(() => {
    document.addEventListener("selectionchange", refreshBlockUi);
    return () => document.removeEventListener("selectionchange", refreshBlockUi);
  }, []);

  useEffect(() => {
    if (!paletteOpen) return;
    function onDoc(event: MouseEvent) {
      const wrap = paletteWrapRef.current;
      if (wrap && wrap.contains(event.target as Node)) return;
      setPaletteOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPaletteOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const pop = palettePopRef.current;
    if (!pop) return;
    pop.style.left = "0";
    pop.style.right = "auto";
    const rect = pop.getBoundingClientRect();
    if (rect.right > window.innerWidth - 18) {
      pop.style.left = "auto";
      pop.style.right = "0";
    }
  }, [paletteOpen]);

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

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const root = refs.current[activeId.current];
    const range = sel.getRangeAt(0);
    if (root && root.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const range = savedRange.current;
    const root = refs.current[activeId.current];
    if (!range || !root) return;
    root.focus();
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function tool(command: string, value?: string) {
    focusActive();
    run(command, value);
    emit(activeId.current);
    refreshBlockUi();
  }

  function applyPaletteColor(color: string) {
    const hit = normalizeInsightColor(color);
    if (!hit) return;
    restoreSelection();
    tool("foreColor", hit);
    setPaletteOpen(false);
  }

  function togglePalette() {
    if (paletteOpen) {
      setPaletteOpen(false);
      return;
    }
    saveSelection();
    setPaletteOpen(true);
  }

  function pickAnyColor() {
    saveSelection();
    colorInputRef.current?.click();
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
    refreshBlockUi();
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
      run("insertHTML", toEditorRef.current(text) || "");
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
    const insert = html ? sanitizeRef.current(html) : toEditorRef.current(text);
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
        <span className="rte-lab">문단</span>
        <span className="rte-grp">
          <button
            type="button"
            className={blockKind === "p" ? "on" : undefined}
            onClick={() => setParagraphKind("p")}
          >
            본문
          </button>
          <button
            type="button"
            className={blockKind === "h2-big" ? "on" : undefined}
            onClick={() => setParagraphKind("h2-big")}
          >
            큰 제목
          </button>
          <button
            type="button"
            className={blockKind === "h2" ? "on" : undefined}
            onClick={() => setParagraphKind("h2")}
          >
            소제목
          </button>
          <button
            type="button"
            className={blockKind === "h3" ? "on" : undefined}
            onClick={() => setParagraphKind("h3")}
          >
            작은 제목
          </button>
        </span>
        <span className="rte-lab rte-lab-size">크기</span>
        <span className="rte-grp">
          <button
            type="button"
            disabled={!sizeEnabled}
            className={sizeEnabled && textSize === "lg" ? "on" : undefined}
            onClick={() => setTextSize("lg")}
          >
            크게
          </button>
          <button
            type="button"
            disabled={!sizeEnabled}
            className={sizeEnabled && textSize === "md" ? "on" : undefined}
            onClick={() => setTextSize("md")}
          >
            보통
          </button>
          <button
            type="button"
            disabled={!sizeEnabled}
            className={sizeEnabled && textSize === "sm" ? "on" : undefined}
            onClick={() => setTextSize("sm")}
          >
            작게
          </button>
        </span>
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
        <button type="button" title="윗첨자" onClick={() => tool("superscript")}>
          x<sup>2</sup>
        </button>
        <button type="button" title="아랫첨자" onClick={() => tool("subscript")}>
          x<sub>2</sub>
        </button>
        <span className="rte-sep" />
        <div ref={paletteWrapRef} className="rte-pop-wrap">
            <button
              type="button"
              title="글꼴 색"
              aria-label="글꼴 색"
              aria-expanded={paletteOpen}
              aria-haspopup="dialog"
              className={`rte-cbtn${paletteOpen ? " on" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={togglePalette}
            >
              <span className="rte-cbtn-a">A</span>
              <span
                className="rte-cbtn-bar"
                style={{ "--sw": activeColor ?? "#0f172a" } as CSSProperties}
              />
            </button>
            {paletteOpen ? (
              <div ref={palettePopRef} className="rte-pop" role="dialog" aria-label="글꼴 색">
                <div className="rte-pop-h">자주 쓰는 색</div>
                <div className="rte-pop-row rte-pop-row-5">
                  {LEAD_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={COLOR_TITLES[color]}
                      className={`rte-pop-sw${activeColor === color ? " on" : ""}`}
                      style={{ "--sw": color } as CSSProperties}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyPaletteColor(color)}
                    />
                  ))}
                </div>
                <div className="rte-pop-div" />
                <div className="rte-pop-h">글꼴 색</div>
                {[0, 8, 16, 24].map((start) => (
                  <div key={start} className="rte-pop-row">
                    {FONT_COLORS.slice(start, start + 8).map((color) => (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        className={`rte-pop-sw${activeColor === color ? " on" : ""}`}
                        style={{ "--sw": color } as CSSProperties}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyPaletteColor(color)}
                      />
                    ))}
                  </div>
                ))}
                <div className="rte-pop-div" />
                <button
                  type="button"
                  className="rte-pop-more"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={pickAnyColor}
                >
                  <span className="rte-pop-more-sw" />
                  더 많은 색…
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  className="rte-pop-native"
                  defaultValue={
                    activeColor && /^#[0-9a-f]{6}$/i.test(activeColor) ? activeColor : "#0f172a"
                  }
                  onChange={(event) => applyPaletteColor(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        <span className="rte-sep" />
        <button type="button" title="내어쓰기" onClick={() => shiftIndent(-1)}>
          <IconOutdent />
        </button>
        <button type="button" title="들여쓰기" onClick={() => shiftIndent(1)}>
          <IconIndent />
        </button>
        <span className="rte-sep" />
        <button type="button" title="글머리 목록" onClick={() => tool("insertUnorderedList")}>
          <IconBulletList />
        </button>
        <button type="button" title="번호 목록" onClick={() => tool("insertOrderedList")}>
          <IconNumberList />
        </button>
        <span className="rte-sep" />
        <button type="button" title="줄바꿈" onClick={insertBreak}>
          ↵
        </button>
        <button type="button" title="링크" onClick={link}>
          링크
        </button>
        {allowMedia ? (
          <>
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

function IconOutdent() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M14 3H2M14 8H7M14 13H2" />
      <path d="M5 6 2.5 8 5 10" />
    </svg>
  );
}

function IconIndent() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M2 3h12M9 8h5M2 13h12" />
      <path d="M3 6 5.5 8 3 10" />
    </svg>
  );
}

function IconBulletList() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="2.5" cy="4" r="1.4" fill="currentColor" />
      <circle cx="2.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="2.5" cy="12" r="1.4" fill="currentColor" />
      <path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconNumberList() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <text x="0" y="5.6" fontSize="5.2" fill="currentColor" fontFamily="inherit">
        1
      </text>
      <text x="0" y="10" fontSize="5.2" fill="currentColor" fontFamily="inherit">
        2
      </text>
      <text x="0" y="14.4" fontSize="5.2" fill="currentColor" fontFamily="inherit">
        3
      </text>
      <path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
