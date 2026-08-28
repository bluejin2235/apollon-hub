"use client";

import { useId, useState, type ReactNode } from "react";

import { GuideDocLink } from "@/components/website/guide-doc-link";
import { GuidePopover } from "@/components/website/ui/GuidePopover";

import "./work-admin.css";

export type FieldCount = {
  label?: string;
  value: number;
  /** 권장. 초과 시 주황 (.nr) */
  recommend?: number;
  /** 한계. 초과 시 빨강 (.ov) */
  limit: number;
};

type FieldProps = {
  label: ReactNode;
  required?: boolean;
  tip?: ReactNode;
  counts?: FieldCount[];
  /** counts 대신 오른쪽 표시. 예: 2개 */
  aside?: ReactNode;
  defaultTipOpen?: boolean;
  /** ? 가이드 하단에 제작 가이드 링크 */
  guideLink?: boolean;
  /** 가이드 절 id — ? 팝오버로 표시 (tip 접기와 함께 쓰지 않음) */
  guideAnchorId?: string;
  className?: string;
  children?: ReactNode;
};

function CountPart({ item }: { item: FieldCount }) {
  const overLimit = item.value > item.limit;
  const overRecommend =
    item.recommend != null && item.value > item.recommend && !overLimit;
  const cls = overLimit ? "ov" : overRecommend ? "nr" : undefined;
  return (
    <>
      {item.label ? `${item.label} ` : null}
      <span className={cls}>{item.value}</span>
      {` / ${item.limit}`}
    </>
  );
}

export function Field({
  label,
  required,
  tip,
  counts,
  aside,
  defaultTipOpen = false,
  guideLink = false,
  guideAnchorId,
  className,
  children,
}: FieldProps) {
  const tipId = useId();
  const [tipOpen, setTipOpen] = useState(defaultTipOpen);
  const fldClass = className ? `wa fld ${className}` : "wa fld";
  const showTipButton = Boolean(tip) && !guideAnchorId;

  return (
    <div className={fldClass}>
      <div className="lab">
        <b>{label}</b>
        {required ? <span className="rq">*</span> : null}
        {guideAnchorId ? (
          <GuidePopover anchorId={guideAnchorId}>?</GuidePopover>
        ) : showTipButton ? (
          <button
            type="button"
            className={tipOpen ? "q on" : "q"}
            aria-expanded={tipOpen}
            aria-controls={tipId}
            onClick={() => setTipOpen((open) => !open)}
          >
            ?
          </button>
        ) : null}
        {aside ? <span className="cn">{aside}</span> : null}
        {!aside && counts && counts.length > 0 ? (
          <span className="cn">
            {counts.map((item, index) => (
              <span key={`${item.label ?? ""}-${item.limit}`}>
                {index > 0 ? " · " : null}
                <CountPart item={item} />
              </span>
            ))}
          </span>
        ) : null}
      </div>
      {children}
      {tip && guideAnchorId ? <div className="tip on">{tip}</div> : null}
      {tip && !guideAnchorId ? (
        <div id={tipId} className={tipOpen ? "tip on" : "tip"}>
          {tip}
          {guideLink ? <GuideDocLink /> : null}
        </div>
      ) : null}
    </div>
  );
}
