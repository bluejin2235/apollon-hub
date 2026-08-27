"use client";

import { useId, useState, type ReactNode } from "react";

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
  className,
  children,
}: FieldProps) {
  const tipId = useId();
  const [tipOpen, setTipOpen] = useState(defaultTipOpen);
  const fldClass = className ? `wa fld ${className}` : "wa fld";

  return (
    <div className={fldClass}>
      <div className="lab">
        <b>{label}</b>
        {required ? <span className="rq">*</span> : null}
        {tip ? (
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
      {tip ? (
        <div id={tipId} className={tipOpen ? "tip on" : "tip"}>
          {tip}
        </div>
      ) : null}
    </div>
  );
}
