"use client";

import { useId, useState, type ReactNode } from "react";

export type MetricHintProps = {
  title: string;
  /** 카드 안에 항상 보이는 한 줄 */
  summary: string;
  definition: string;
  criterion: string;
  action: string;
  limit: string;
  children?: ReactNode;
};

export function MetricHint({
  title,
  summary,
  definition,
  criterion,
  action,
  limit,
  children
}: MetricHintProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="ws-lab">
        {title}
        <button
          type="button"
          className="ws-q"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${title} 설명`}
          onClick={() => setOpen((value) => !value)}
        >
          ?
        </button>
      </div>
      {children}
      <p className="ws-hint-summary">{summary}</p>
      {open ? (
        <div className="ws-hint-panel" id={panelId}>
          <div className="ws-hint-title">{title}</div>
          <div>
            <b>정의</b> {definition}
          </div>
          <div>
            <b>기준</b> {criterion}
          </div>
          <div>
            <b>할 일</b> {action}
          </div>
          <div>
            <b>한계</b> {limit}
          </div>
        </div>
      ) : null}
    </>
  );
}
