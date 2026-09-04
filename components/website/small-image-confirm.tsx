"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import {
  SMALL_IMAGE_CONFIRM_FOOT_1,
  SMALL_IMAGE_CONFIRM_FOOT_2,
  SMALL_IMAGE_CONFIRM_FRAME,
  SMALL_IMAGE_CONFIRM_LEAD_AFTER,
  SMALL_IMAGE_CONFIRM_LEAD_BEFORE,
  SMALL_IMAGE_CONFIRM_LEAD_EMPHASIS,
  SMALL_IMAGE_HINT,
  SMALL_IMAGE_PILL
} from "@/lib/website/spec";
import { isLongEdgeTooSmall } from "@/lib/website/image-long-edge";
import "@/components/website/ui/work-admin.css";

export function formatPixelSize(width: number, height: number) {
  return `${width} × ${height}`;
}

export function SmallImageMarks({
  width,
  height,
  src,
  mime
}: {
  width: number | null | undefined;
  height: number | null | undefined;
  src?: string | null;
  mime?: string | null;
}) {
  if (!isLongEdgeTooSmall(width, height, { src, mime })) return null;
  return (
    <>
      <span className="sic-pill">{SMALL_IMAGE_PILL}</span>
      <span className="sic-hint">{SMALL_IMAGE_HINT}</span>
    </>
  );
}

type ConfirmProps = {
  open: boolean;
  previewUrl: string;
  width: number;
  height: number;
  onUpload: () => void;
  onCancel: () => void;
};

export function SmallImageConfirm({ open, previewUrl, width, height, onUpload, onCancel }: ConfirmProps) {
  const titleId = useId();
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="sic-full" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="sic-close" aria-label="닫기" onClick={onCancel}>
        ×
      </button>
      <div className="sic-top">
        <p id={titleId} className="sic-lead">
          {SMALL_IMAGE_CONFIRM_LEAD_BEFORE}
          <b>{SMALL_IMAGE_CONFIRM_LEAD_EMPHASIS}</b>
          {SMALL_IMAGE_CONFIRM_LEAD_AFTER}
        </p>
      </div>
      <div className="sic-mid">
        <div className="sic-holder">
          <span className="sic-ruler">{SMALL_IMAGE_CONFIRM_FRAME}</span>
          <span className="sic-guide" />
          <svg className="sic-svg" viewBox="0 0 1600 900" role="img">
            <title>{formatPixelSize(width, height)}</title>
            <image href={previewUrl} width={width} height={height} />
            <text
              x={width / 2}
              y={height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="sic-px-svg"
            >
              {formatPixelSize(width, height)}
            </text>
          </svg>
        </div>
      </div>
      <div className="sic-bot">
        <p className="sic-foot">
          {SMALL_IMAGE_CONFIRM_FOOT_1}
          <br />
          {SMALL_IMAGE_CONFIRM_FOOT_2}
        </p>
        <div className="sic-btns">
          <button type="button" className="sic-btn" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="sic-btn sic-btn-warn" onClick={onUpload}>
            업로드
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function isCoverUploadKind(kind: string) {
  return kind === "key" || kind === "insight-key";
}
