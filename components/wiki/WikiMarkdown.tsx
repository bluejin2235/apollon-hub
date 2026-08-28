"use client";

import { WikiBodyMarkdown } from "@/components/wiki/WikiBodyMarkdown";

export function WikiMarkdown({ text }: { text: string }) {
  return <WikiBodyMarkdown text={text || ""} highlightTerms />;
}
