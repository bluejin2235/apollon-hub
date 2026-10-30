import {
  COLOR_SET,
  PALETTE,
  normalizePaletteColor,
  sanitizeRichHtml
} from "@/lib/website/rich-html";

export const LEAD_COLORS = PALETTE;

/** 워크 기본 설명 — 공개 content__body 와 맞춤 */
export const LEAD_KO_LIMIT = 500;
export const LEAD_EN_LIMIT = 1000;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function normalizeLeadColor(value: string): string | null {
  const hit = normalizePaletteColor(value);
  return hit && COLOR_SET.has(hit) ? hit : null;
}

function asParagraph(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return "<p><br></p>";
  return `<p>${trimmed}</p>`;
}

/** 예전 저장분: 문단을 &lt;br&gt; 로만 나눈 HTML → 편집용 &lt;p&gt; */
function brSeparatedToParagraphs(html: string): string {
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((part) => part.trim())
    .filter((part, index, arr) => part.length > 0 || (index > 0 && index < arr.length - 1));

  if (parts.length === 0) return "<p><br></p>";

  return parts
    .map((part) => {
      if (!part) return "<p><br></p>";
      if (/^<(p|ul)\b/i.test(part)) return part;
      return `<p>${part}</p>`;
    })
    .join("");
}

/** 허용: p · b · i · u · br · ul · li · a(href) · span(색만) */
export function sanitizeLeadHtml(html: string): string {
  return sanitizeRichHtml(html, "basic", { ol: "ul", allowImg: false });
}

export function leadPlainText(html: string): string {
  return sanitizeLeadHtml(html)
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

export function leadCharCount(html: string): number {
  return leadPlainText(html).replace(/\n+/g, "").length;
}

export function leadToEditorHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "<p><br></p>";
  if (leadLooksLikeHtml(value)) {
    const clean = sanitizeLeadHtml(value);
    if (!clean) return "<p><br></p>";
    if (/^<(p|ul)\b/i.test(clean)) return clean;
    if (/<br\s*\/?>/i.test(clean)) return brSeparatedToParagraphs(clean);
    return asParagraph(clean);
  }
  return trimmed
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((para) => asParagraph(escapeText(para.trim()).replace(/\n/g, "<br>")))
    .join("");
}

export function leadIsEmpty(html: string): boolean {
  return leadCharCount(html) === 0;
}

export function leadLooksLikeHtml(value: string): boolean {
  return /<(p|b|i|u|br|ul|ol|li|a|span|strong|em|font|div|h[1-6])\b/i.test(value);
}
