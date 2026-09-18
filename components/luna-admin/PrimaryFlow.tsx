"use client";

import type { PrimaryFlowStep } from "@/lib/luna-admin/types";

export function PrimaryFlow({
  steps,
  caption,
  onAsk
}: {
  steps: PrimaryFlowStep[];
  caption?: string;
  onAsk?: (id: string) => void;
}) {
  return (
    <>
      {caption ? (
        <div className="sech">
          <span className="t">{caption}</span>
        </div>
      ) : null}
      <div className="flow pipe">
        {steps.map((step, i) => (
          <div key={step.t} className={`st${step.loss ? " loss" : ""}`}>
            <div className="t">
              {step.t}
              {step.q && onAsk ? (
                <button type="button" className="q" onClick={() => onAsk(step.q!)}>
                  ?
                </button>
              ) : null}
            </div>
            <div className="v">{step.v.toLocaleString("ko-KR")}</div>
            {step.d ? <div className="d">{step.d}</div> : null}
            {i < steps.length - 1 ? <span className="arrow">→</span> : null}
          </div>
        ))}
      </div>
    </>
  );
}
