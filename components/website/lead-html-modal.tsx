"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { showToast } from "@/components/website/toast";
import {
  RichTextEditor,
  RICH_TEXT_SURFACE_DEFAULTS,
  type RichTextSurface
} from "@/components/website/rich-text-editor";
import {
  LEAD_EN_LIMIT,
  LEAD_KO_LIMIT,
  leadCharCount,
  leadToEditorHtml,
  sanitizeLeadHtml
} from "@/lib/website/lead-html";

type Props = {
  open: boolean;
  /** 기본 「기본 설명」. 인사이트 본문은 「글」 등 */
  title?: string;
  subtitle: string;
  ko: string;
  en: string;
  surface?: RichTextSurface;
  sanitize?: (html: string) => string;
  toEditorHtml?: (text: string) => string;
  charCount?: (html: string) => number;
  /** 있으면 확인 시 초과 저장을 막는다. 워크 기본 설명 기본값 500/1000 */
  limits?: { ko: number; en: number } | null;
  fontSize?: string;
  lineHeight?: string;
  contentWidth?: number;
  hint?: ReactNode;
  onCancel: () => void;
  onSave: (next: { ko: string; en: string }) => void;
};

export function LeadHtmlModal({
  open,
  title = "기본 설명",
  subtitle,
  ko,
  en,
  surface = "work-lead",
  sanitize = sanitizeLeadHtml,
  toEditorHtml = leadToEditorHtml,
  charCount = leadCharCount,
  limits = surface === "work-lead" ? { ko: LEAD_KO_LIMIT, en: LEAD_EN_LIMIT } : null,
  fontSize,
  lineHeight,
  contentWidth,
  hint = "이미지는 넣을 수 없습니다. 아래 블록에서 넣으세요",
  onCancel,
  onSave
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [draftKo, setDraftKo] = useState(ko);
  const [draftEn, setDraftEn] = useState(en);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraftKo(toEditorHtml(ko));
    setDraftEn(toEditorHtml(en));
  }, [open, ko, en, toEditorHtml]);

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

  if (!open || !mounted) return null;

  const koCount = charCount(draftKo);
  const enCount = charCount(draftEn);
  const koOver = limits != null && koCount > limits.ko;
  const enOver = limits != null && enCount > limits.en;
  const defaults = RICH_TEXT_SURFACE_DEFAULTS[surface];

  function confirm() {
    if (limits) {
      if (koCount > limits.ko || enCount > limits.en) {
        showToast({
          message: `글자 수 한도 — 국문 ${limits.ko} · 영문 ${limits.en}`,
          tone: "warn"
        });
        return;
      }
    }
    onSave({
      ko: sanitize(draftKo),
      en: sanitize(draftEn)
    });
  }

  return createPortal(
    <div className="wa">
      <div className="lead-ov">
        <div className="lead-mw">
          <div className="lead-mwh">
            <div>
              <b>{title}</b>
              <span className="lead-sub">{subtitle}</span>
            </div>
            <button type="button" className="xb" onClick={onCancel}>
              ×
            </button>
          </div>
          <div className="lead-body">
            <RichTextEditor
              surface={surface}
              sanitize={sanitize}
              toEditorHtml={toEditorHtml}
              fontSize={fontSize ?? defaults.fontSize}
              lineHeight={lineHeight ?? defaults.lineHeight}
              contentWidth={contentWidth ?? defaults.contentWidth}
              fields={[
                {
                  id: "ko",
                  label: "국문",
                  extra: (
                    <span className={koOver ? "rte-cc is-over" : "rte-cc"}>
                      국문 {koCount}
                      {limits ? ` / ${limits.ko}` : ""}
                    </span>
                  ),
                  value: draftKo,
                  onChange: setDraftKo
                },
                {
                  id: "en",
                  label: "영문",
                  extra: (
                    <span className={enOver ? "rte-cc is-over" : "rte-cc"}>
                      영문 {enCount}
                      {limits ? ` / ${limits.en}` : ""}
                    </span>
                  ),
                  value: draftEn,
                  onChange: setDraftEn
                }
              ]}
            />
          </div>
          <div className="lead-mwf">
            <span className="hint">{hint}</span>
            <div className="lead-btns">
              <button type="button" className="btn" onClick={onCancel}>
                취소
              </button>
              <button type="button" className="btn acc" onClick={confirm}>
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
