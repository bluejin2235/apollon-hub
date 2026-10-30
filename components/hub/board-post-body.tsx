"use client";

import {
  insightLooksLikeHtml,
  insightPlainToHtml,
  sanitizeInsightHtml
} from "@/lib/website/insight-html";

function toBoardBodyHtml(value: string): string {
  const source = insightLooksLikeHtml(value) ? value : insightPlainToHtml(value);
  return sanitizeInsightHtml(source);
}

export function BoardPostBody({ content }: { content: string }) {
  return <div className="board-body" dangerouslySetInnerHTML={{ __html: toBoardBodyHtml(content) }} />;
}
