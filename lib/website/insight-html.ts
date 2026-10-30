/** 인사이트 글 블록. full 프로필. */

import { normalizePaletteColor, sanitizeRichHtml } from "@/lib/website/rich-html";

export function normalizeInsightColor(value: string): string | null {
  return normalizePaletteColor(value);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isVisuallyEmptyHtml(inner: string): boolean {
  return !inner
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function asParagraph(inner: string): string {
  if (isVisuallyEmptyHtml(inner)) return "";
  return `<p>${inner.trim()}</p>`;
}

export function insightLooksLikeHtml(value: string): boolean {
  return /<(p|b|i|u|br|ul|ol|li|a|span|strong|em|div|h[1-6]|font|sup|sub)\b/i.test(value);
}

export function insightPlainToHtml(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((para) => asParagraph(escapeText(para).replace(/\n/g, "<br>")))
    .join("");
}

export function sanitizeInsightHtml(html: string): string {
  return sanitizeRichHtml(html, "full");
}

export function insightToEditorHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "<p><br></p>";
  if (insightLooksLikeHtml(value)) {
    const clean = sanitizeInsightHtml(value);
    if (!clean) return "<p><br></p>";
    if (/^<(p|ul|h[23])\b/i.test(clean)) return clean;
    return asParagraph(clean);
  }
  return insightPlainToHtml(value) || "<p><br></p>";
}

export function insightPlainText(html: string): string {
  return sanitizeInsightHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p\b[^>]*>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ");
}

export function insightCharCount(html: string): number {
  return insightPlainText(html).replace(/\n+/g, "").length;
}

export function insightIsEmpty(html: string): boolean {
  return insightCharCount(html) === 0;
}
