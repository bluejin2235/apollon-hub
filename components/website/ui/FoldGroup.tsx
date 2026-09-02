"use client";

import { useId, useState, type ReactNode } from "react";

import { GuidePopover } from "@/components/website/ui/GuidePopover";

import "./work-admin.css";

type CountTone = "ok" | "warn" | "faint";

type FoldGroupProps = {
  title: ReactNode;
  summary?: ReactNode;
  /** 머리 오른쪽. 예: 5 / 6, 3개 */
  count?: ReactNode;
  countTone?: CountTone;
  filled?: number;
  total?: number;
  guideAnchorId?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 접이식 헤더 오른쪽 (부분 저장 등) */
  headerExtra?: ReactNode;
  children?: ReactNode;
};

export function FoldGroup({
  title,
  summary,
  count,
  countTone = "faint",
  filled,
  total,
  guideAnchorId,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  headerExtra,
  children,
}: FoldGroupProps) {
  const bodyId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = openProp ?? uncontrolled;

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }

  const countText =
    count ??
    (filled != null && total != null ? `${filled} / ${total}` : null);

  return (
    <div className={open ? "wa fold on" : "wa fold"}>
      <div className="fh-row">
        <button
          type="button"
          className="fh fh-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <b>{title}</b>
          {guideAnchorId ? (
            <span
              className="fold-guide"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <GuidePopover anchorId={guideAnchorId}>?</GuidePopover>
            </span>
          ) : null}
          {summary ? <span className="s">{summary}</span> : null}
          {countText != null ? (
            <span
              className={
                countTone === "ok" ? "cnt ok" : countTone === "warn" ? "cnt warn" : "cnt"
              }
            >
              {countText}
            </span>
          ) : (
            <span className="cnt" />
          )}
          <span className="ar" aria-hidden>
            ▾
          </span>
        </button>
        {headerExtra ? <div className="fh-extra">{headerExtra}</div> : null}
      </div>
      <div id={bodyId} className="fb">
        {children}
      </div>
    </div>
  );
}
