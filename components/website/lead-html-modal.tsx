"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RichTextEditor } from "@/components/website/rich-text-editor";
import {
  leadCharCount,
  leadToEditorHtml,
  sanitizeLeadHtml
} from "@/lib/website/lead-html";

const KO_LIMIT = 300;
const EN_LIMIT = 600;

type Props = {
  open: boolean;
  subtitle: string;
  ko: string;
  en: string;
  onCancel: () => void;
  onSave: (next: { ko: string; en: string }) => void;
};

export function LeadHtmlModal({ open, subtitle, ko, en, onCancel, onSave }: Props) {
  const [mounted, setMounted] = useState(false);
  const [draftKo, setDraftKo] = useState(ko);
  const [draftEn, setDraftEn] = useState(en);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraftKo(ko);
    setDraftEn(en);
  }, [open, ko, en]);

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

  const koCount = leadCharCount(draftKo);
  const enCount = leadCharCount(draftEn);

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
          <div className="lead-body">
            <RichTextEditor
              sanitize={sanitizeLeadHtml}
              toEditorHtml={leadToEditorHtml}
              fields={[
                {
                  id: "ko",
                  label: "국문",
                  extra: (
                    <span className={koCount > KO_LIMIT ? "rte-cc is-over" : "rte-cc"}>
                      {koCount} / {KO_LIMIT}
                    </span>
                  ),
                  value: draftKo,
                  onChange: setDraftKo
                },
                {
                  id: "en",
                  label: "영문",
                  extra: (
                    <span className={enCount > EN_LIMIT ? "rte-cc is-over" : "rte-cc"}>
                      {enCount} / {EN_LIMIT}
                    </span>
                  ),
                  value: draftEn,
                  onChange: setDraftEn
                }
              ]}
            />
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
                onClick={() =>
                  onSave({
                    ko: sanitizeLeadHtml(draftKo),
                    en: sanitizeLeadHtml(draftEn)
                  })
                }
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
