"use client";

import { useMemo } from "react";
import { W } from "@/components/wiki/wiki-theme";
import { diffLines } from "@/lib/wiki/diff";

export function WikiDiffView({
  before,
  after
}: {
  before: string;
  after: string;
}) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div
        className="overflow-auto rounded-[11px] border p-3 text-[12px] leading-relaxed"
        style={{ borderColor: W.line }}
      >
        <div className="mb-2 text-[10.5px] font-bold" style={{ color: W.faint }}>
          이전
        </div>
        {lines.map((line, i) =>
          line.type === "add" ? null : (
            <div
              key={`b-${i}`}
              className="whitespace-pre-wrap"
              style={
                line.type === "del"
                  ? { background: W.delBg, color: W.del }
                  : { color: W.ink }
              }
            >
              {line.text || " "}
            </div>
          )
        )}
      </div>
      <div
        className="overflow-auto rounded-[11px] border p-3 text-[12px] leading-relaxed"
        style={{ borderColor: W.line }}
      >
        <div className="mb-2 text-[10.5px] font-bold" style={{ color: W.faint }}>
          이후
        </div>
        {lines.map((line, i) =>
          line.type === "del" ? null : (
            <div
              key={`a-${i}`}
              className="whitespace-pre-wrap"
              style={
                line.type === "add"
                  ? { background: W.addBg, color: W.add }
                  : { color: W.ink }
              }
            >
              {line.text || " "}
            </div>
          )
        )}
      </div>
    </div>
  );
}
