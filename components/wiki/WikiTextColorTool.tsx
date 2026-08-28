"use client";

import { useEffect, useId, useRef, useState } from "react";
import { W } from "@/components/wiki/wiki-theme";
import {
  applyWikiTextColorToSelection,
  getRecentWikiTextColors,
  isValidWikiHexColor,
  normalizeWikiHexColor,
  rememberWikiTextColor,
  removeWikiTextColorFromSelection,
  WIKI_PRESET_TEXT_COLORS
} from "@/lib/wiki/text-color";

type Props = {
  onApply: (
    fn: (el: HTMLTextAreaElement) => {
      next: string;
      selectionStart: number;
      selectionEnd: number;
    }
  ) => void;
};

export function WikiTextColorTool({ onApply }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [customHex, setCustomHex] = useState("#b0231e");
  const [hexInput, setHexInput] = useState("#b0231e");

  useEffect(() => {
    if (open) setRecent(getRecentWikiTextColors());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function pick(hex: string) {
    if (!isValidWikiHexColor(hex)) return;
    const color = normalizeWikiHexColor(hex);
    rememberWikiTextColor(color);
    setRecent(getRecentWikiTextColors());
    onApply((el) => applyWikiTextColorToSelection(el.value, el.selectionStart, el.selectionEnd, color));
    setOpen(false);
  }

  function clearColor() {
    onApply((el) =>
      removeWikiTextColorFromSelection(el.value, el.selectionStart, el.selectionEnd)
    );
    setOpen(false);
  }

  function onHexInputChange(raw: string) {
    setHexInput(raw);
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (isValidWikiHexColor(normalized)) {
      setCustomHex(normalized);
    }
  }

  return (
    <div ref={rootRef} className="wiki-text-color-tool">
      <button
        type="button"
        className="wiki-text-color-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        style={{ color: W.sub }}
      >
        글자 색
      </button>
      {open ? (
        <div id={panelId} className="wiki-text-color-panel" role="dialog" aria-label="글자 색">
          {recent.length > 0 ? (
            <div className="wiki-text-color-section">
              <div className="wiki-text-color-label">최근</div>
              <div className="wiki-text-color-swatches">
                {recent.map((hex) => (
                  <ColorSwatch key={hex} hex={hex} title={hex} onPick={() => pick(hex)} />
                ))}
              </div>
            </div>
          ) : null}
          <div className="wiki-text-color-section">
            <div className="wiki-text-color-label">자주 쓰는 색</div>
            <div className="wiki-text-color-swatches">
              {WIKI_PRESET_TEXT_COLORS.map((item) => (
                <ColorSwatch
                  key={item.hex}
                  hex={item.hex}
                  title={item.label}
                  onPick={() => pick(item.hex)}
                />
              ))}
            </div>
          </div>
          <div className="wiki-text-color-section">
            <div className="wiki-text-color-label">직접 고르기</div>
            <div className="wiki-text-color-custom">
              <input
                type="color"
                value={customHex}
                onChange={(e) => {
                  const hex = normalizeWikiHexColor(e.target.value);
                  setCustomHex(hex);
                  setHexInput(hex);
                }}
                aria-label="색 선택"
              />
              <input
                type="text"
                value={hexInput}
                onChange={(e) => onHexInputChange(e.target.value)}
                placeholder="#b0231e"
                spellCheck={false}
                aria-label="hex 색상"
              />
              <button
                type="button"
                className="wiki-text-color-apply"
                onClick={() => pick(hexInput)}
                disabled={!isValidWikiHexColor(hexInput.startsWith("#") ? hexInput : `#${hexInput}`)}
              >
                적용
              </button>
            </div>
          </div>
          <button type="button" className="wiki-text-color-clear" onClick={clearColor}>
            색 빼기
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ColorSwatch({
  hex,
  title,
  onPick
}: {
  hex: string;
  title: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="wiki-text-color-swatch"
      title={title}
      aria-label={title}
      style={{ background: hex }}
      onClick={onPick}
    />
  );
}
