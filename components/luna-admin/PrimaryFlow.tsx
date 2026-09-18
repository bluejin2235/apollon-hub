"use client";

import type { PrimaryFlowStep } from "@/lib/luna-admin/types";

export function PrimaryFlow({
  steps,
  caption
}: {
  steps: PrimaryFlowStep[];
  caption?: string;
}) {
  return (
    <>
      {caption ? (
        <div className="sech">
          <span className="t">{caption}</span>
          <span className="n">Work서버</span>
        </div>
      ) : null}
      <div className="flow pipe">
        {steps.map((step, i) => (
          <div key={step.t} className={`st${step.loss ? " loss" : ""}`}>
            <div className="t">{step.t}</div>
            <div className="v">{step.v.toLocaleString("ko-KR")}</div>
            {step.d ? <div className="d">{step.d}</div> : null}
            {i < steps.length - 1 ? <span className="arrow">→</span> : null}
          </div>
        ))}
      </div>
    </>
  );
}
