"use client";

import type { ReactNode } from "react";
import type { PairSideView } from "@/lib/luna-admin/pair-view";

function Side({ side }: { side: PairSideView }) {
  return (
    <div className="side">
      <div className="s">{side.typeLabel}</div>
      <div className="t">{side.title}</div>
      {side.path ? <div className="m">{side.path}</div> : null}
      {side.facts ? <div className="x">{side.facts}</div> : null}
    </div>
  );
}

export function SamePairCard({
  left,
  right,
  reason,
  dim,
  checkbox,
  actions,
  footer
}: {
  left: PairSideView;
  right: PairSideView;
  reason?: string;
  dim?: boolean;
  checkbox?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="pair-wrap">
      <div className={`pair ${dim ? "dim" : ""}`}>
        {checkbox}
        <Side side={left} />
        <div className="mid">=</div>
        <Side side={right} />
        {actions ? (
          <div className="rev">
            {reason ? <div className="why">{reason}</div> : null}
            {actions}
          </div>
        ) : null}
      </div>
      {footer ? (
        <div className="pair-foot">
          {reason && !actions ? (
            <div className="why">근거: {reason}</div>
          ) : null}
          {footer}
        </div>
      ) : null}
    </div>
  );
}
