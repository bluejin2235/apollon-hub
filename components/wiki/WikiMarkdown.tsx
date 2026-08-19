"use client";

import { SafeMarkdown } from "@/components/luna/SafeMarkdown";

export function WikiMarkdown({ text }: { text: string }) {
  return (
    <SafeMarkdown
      content={text || ""}
      highlightTerms
      className="text-[13px] leading-[1.9] text-[#2a2c31]"
    />
  );
}
