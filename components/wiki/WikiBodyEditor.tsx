"use client";

import { useRef, useState, type RefObject } from "react";
import { WikiBodyMarkdown } from "@/components/wiki/WikiBodyMarkdown";
import { WikiTextColorTool } from "@/components/wiki/WikiTextColorTool";
import { WikiYoutubeEmbed } from "@/components/wiki/WikiYoutubeEmbed";
import { wikiFetch, wikiUploadFile } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import { WIKI_TABLE_TEMPLATE } from "@/lib/wiki/body-markdown";
import {
  parseWikiBody,
  parseYoutubeId,
  wikiImageToken,
  wikiYoutubeToken,
  type WikiBodyBlock
} from "@/lib/wiki/media";
import { handleWikiTableKeyDown } from "@/lib/wiki/table-cursor";
import "@/components/wiki/wiki-body.css";
function serialize(blocks: WikiBodyBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "md") return b.text;
      if (b.type === "image") return wikiImageToken(b.url, b.caption);
      return wikiYoutubeToken(b.id, b.title);
    })
    .join("\n\n")
    .trim();
}

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
  return value.slice(0, start) + before + selected + after + value.slice(end);
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

function WikiMdSplitEditor({
  value,
  onChange,
  textareaRef,
  onPasteUrl,
  onPasteImage
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onPasteUrl?: (url: string) => boolean;
  onPasteImage?: (file: File) => void;
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? innerRef;
  const [mobileTab, setMobileTab] = useState<"source" | "preview">("source");

  function applyWithCursor(next: string, cursor: number) {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="wiki-body-editor-split">
      <div className="wiki-body-editor-tabs md:hidden">
        <button
          type="button"
          className={`wiki-body-editor-tab${mobileTab === "source" ? " is-active" : ""}`}
          onClick={() => setMobileTab("source")}
        >
          원문
        </button>
        <button
          type="button"
          className={`wiki-body-editor-tab${mobileTab === "preview" ? " is-active" : ""}`}
          onClick={() => setMobileTab("preview")}
        >
          미리보기
        </button>
      </div>
      <div className="wiki-body-editor-panes">
        <div
          className={`wiki-body-editor-source${mobileTab === "preview" ? " max-md:hidden" : ""}`}
        >
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              handleWikiTableKeyDown(e, value, applyWithCursor);
            }}
            onPaste={(e) => {
              const file = e.clipboardData.files[0];
              if (file && file.type.startsWith("image/")) {
                e.preventDefault();
                onPasteImage?.(file);
                return;
              }
              const text = e.clipboardData.getData("text");
              if (text && onPasteUrl?.(text)) {
                e.preventDefault();
              }
            }}
            className="wiki-body-editor-textarea"
            spellCheck={false}
          />
        </div>
        <div
          className={`wiki-body-editor-preview wiki-body-editor-preview-pane${
            mobileTab === "source" ? " max-md:hidden" : ""
          }`}
        >
          <WikiBodyMarkdown text={value} />
        </div>
      </div>
    </div>
  );
}

export function WikiBodyEditor({  value,
  onChange,
  slug,
  showHeadingTools,
  onHeading1,
  onUndo
}: {
  value: string;
  onChange: (next: string) => void;
  slug: string;
  showHeadingTools?: boolean;
  onHeading1?: () => void;
  onUndo?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const focusRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState("");
  const blocks = parseWikiBody(value);
  const display =
    blocks.length > 0 ? blocks : ([{ type: "md", text: value }] as WikiBodyBlock[]);

  function commit(next: WikiBodyBlock[]) {
    onChange(serialize(next));
  }

  function applyToFocused(fn: (el: HTMLTextAreaElement) => string) {
    const el = focusRef.current;
    if (!el) return;
    onChange(
      serialize(
        display.map((b) =>
          b.type === "md" && el.value === b.text ? { type: "md", text: fn(el) } : b
        )
      )
    );
  }

  function insertAtCursor(token: string) {
    const el = focusRef.current;
    if (el) {
      const start = el.selectionStart;
      const next = `${el.value.slice(0, start)}\n\n${token}\n\n${el.value.slice(start)}`;
      const rebuilt = display.map((b) =>
        b.type === "md" && b.text === el.value ? { type: "md" as const, text: next } : b
      );
      commit(rebuilt);
      return;
    }
    commit([...display, { type: "md", text: token }]);
  }

  async function addYoutube(raw: string): Promise<boolean> {
    const id = parseYoutubeId(raw);
    if (!id) return false;
    setBusy("유튜브…");
    try {
      const json = await wikiFetch<{ id?: string; title?: string }>(
        `/api/wiki/youtube?id=${encodeURIComponent(id)}`
      );
      insertAtCursor(wikiYoutubeToken(json.id ?? id, json.title ?? ""));
      return true;
    } catch {
      insertAtCursor(wikiYoutubeToken(id, ""));
      return true;
    } finally {
      setBusy("");
    }
  }

  async function addImage(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      window.alert("이미지는 10MB 이하여야 합니다.");
      return;
    }
    setBusy("이미지…");
    try {
      const { url } = await wikiUploadFile(file, slug);
      const caption = window.prompt("캡션", file.name.replace(/\.[^.]+$/, "")) ?? "";
      insertAtCursor(wikiImageToken(url, caption));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "업로드 실패");
    } finally {
      setBusy("");
    }
  }

  function insertTable() {
    const el = focusRef.current;
    if (!el) {
      insertAtCursor(WIKI_TABLE_TEMPLATE);
      return;
    }
    const start = el.selectionStart;
    const next =
      el.value.slice(0, start) + WIKI_TABLE_TEMPLATE + el.value.slice(start);
    const rebuilt = display.map((b) =>
      b.type === "md" && b.text === el.value ? { type: "md" as const, text: next } : b
    );
    commit(rebuilt);
  }

  function applyWithSelection(
    fn: (el: HTMLTextAreaElement) => {
      next: string;
      selectionStart: number;
      selectionEnd: number;
    }
  ) {
    const el = focusRef.current;
    if (!el) return;
    const result = fn(el);
    const rebuilt = display.map((b) =>
      b.type === "md" && el.value === b.text ? { type: "md" as const, text: result.next } : b
    );
    commit(rebuilt);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  function link() {
    const href = window.prompt("연결할 주소", "https://");
    if (!href) return;
    applyToFocused((el) => wrapSelection(el, "[", `](${href})`, "이름"));
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-[11px] py-[7px]"
        style={{ borderColor: W.line2, background: "#FBFBFC" }}
      >
        {showHeadingTools ? (
          <>
            <Tool onClick={() => onHeading1?.()}>제목1</Tool>
            <Tool
              onClick={() =>
                applyToFocused((el) => prefixLines(el, "## "))
              }
            >
              제목2
            </Tool>
            <span className="mx-1 h-[15px] w-px" style={{ background: W.line }} />
          </>
        ) : null}
        <Tool onClick={() => applyToFocused((el) => wrapSelection(el, "**", "**"))}>
          <b>B</b>
        </Tool>
        <Tool onClick={() => applyToFocused((el) => wrapSelection(el, "*", "*"))}>
          <i>I</i>
        </Tool>
        <WikiTextColorTool onApply={applyWithSelection} />
        <Tool onClick={() => applyToFocused((el) => prefixLines(el, "- "))}>• 목록</Tool>
        <Tool onClick={() => applyToFocused((el) => prefixLines(el, "1. "))}>1. 번호</Tool>
        <Tool onClick={insertTable}>표 넣기</Tool>
        <span className="mx-1 h-[15px] w-px" style={{ background: W.line }} />
        <Tool onClick={link}>🔗 링크</Tool>
        <Tool onClick={() => fileRef.current?.click()}>📷 이미지</Tool>
        <Tool
          onClick={() => {
            const url = window.prompt("유튜브 주소");
            if (url) void addYoutube(url);
          }}
        >
          ▶ 유튜브
        </Tool>
        {onUndo ? (
          <>
            <span className="mx-1 h-[15px] w-px" style={{ background: W.line }} />
            <Tool onClick={onUndo}>↩ 되돌리기</Tool>
          </>
        ) : null}
        {busy ? (
          <span className="ml-2 text-[10.5px]" style={{ color: W.faint }}>
            {busy}
          </span>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void addImage(f);
        }}
      />
      <p className="border-b px-[11px] py-[7px] text-[10.5px] leading-relaxed" style={{ borderColor: W.line2, color: W.faint }}>
        표는 <code>| 칸 | 칸 |</code> 으로, 소제목은 <code>##</code> 으로, 굵게는 <code>**굵게**</code>, 색은 <code>[color=#b0231e]빨강[/color]</code> 로 씁니다
      </p>
      <div
        className="px-[14px] py-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void addImage(f);
        }}
      >
        {display.map((b, i) => {
          if (b.type === "image") {
            return (
              <figure key={`i-${i}`} className="my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.caption} className="max-h-48 rounded-lg object-cover" />
                <input
                  value={b.caption}
                  onChange={(e) => {
                    const next = [...display];
                    next[i] = { ...b, caption: e.target.value };
                    commit(next);
                  }}
                  placeholder="캡션"
                  className="mt-1 w-full text-[10.5px] outline-none"
                  style={{ color: W.faint }}
                />
              </figure>
            );
          }
          if (b.type === "youtube") {
            return <WikiYoutubeEmbed key={`y-${i}`} id={b.id} title={b.title} />;
          }
          return (
            <WikiMdSplitEditor
              key={`t-${i}`}
              value={b.text}
              textareaRef={focusRef}
              onPasteUrl={(url) => {
                void addYoutube(url);
                return Boolean(parseYoutubeId(url));
              }}
              onPasteImage={(file) => void addImage(file)}
              onChange={(text) => {
                const next = [...display];
                next[i] = { type: "md", text };
                commit(next);
              }}
            />
          );        })}
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
      className="rounded-md px-2 py-1 text-[11px] hover:bg-[#f1f2f5]"
      style={{ color: W.sub }}
    >
      {children}
    </button>
  );
}
