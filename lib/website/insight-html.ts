/** 인사이트 글 블록 붙여넣기 살균. 허용: b · i · u · br · p · ul · li · a(href) · span(우리 팔레트 색만) */

import { normalizeLeadColor } from "@/lib/website/lead-html";

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrap(inner: string, open: string, close: string): string {
  return inner ? `${open}${inner}${close}` : "";
}

function isElem(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isBoldStyle(style: string): boolean {
  return (
    /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || /\bfont:[^;]*\bbold\b/i.test(style)
  );
}

function colorFromElement(el: Element): string | null {
  const style = el.getAttribute("style") ?? "";
  const color = style.match(/color\s*:\s*([^;]+)/i);
  if (color) {
    const hit = normalizeLeadColor(color[1] ?? "");
    if (hit) return hit;
  }
  const attr = el.getAttribute("color");
  if (attr) return normalizeLeadColor(attr);
  return null;
}

function sanitizeHref(raw: string | null): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href) return null;
  if (/^javascript:/i.test(href)) return null;
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
  return null;
}

function applyInlineFormat(el: HTMLElement, inner: string): string {
  const style = el.getAttribute("style") ?? "";
  const tag = el.tagName;
  const color = colorFromElement(el);
  let next = inner;
  if (tag === "B" || tag === "STRONG" || isBoldStyle(style)) {
    next = wrap(next, "<b>", "</b>");
  }
  if (tag === "I" || tag === "EM" || /font-style\s*:\s*italic/i.test(style)) {
    next = wrap(next, "<i>", "</i>");
  }
  if (tag === "U" || /text-decoration[^;]*underline/i.test(style)) {
    next = wrap(next, "<u>", "</u>");
  }
  if (color && next) return `<span style="color:${color}">${next}</span>`;
  return next;
}

function serializeChildren(el: HTMLElement): string {
  return Array.from(el.childNodes)
    .map((node) => serialize(node))
    .join("");
}

function asParagraph(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return "";
  return `<p>${trimmed}</p>`;
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText((node.textContent ?? "").replace(/\u200B/g, ""));
  }
  if (!isElem(node)) return "";

  const el = node;
  const tag = el.tagName;
  const inner = serializeChildren(el);

  if (tag === "BR") return "<br>";
  if (tag === "B" || tag === "STRONG") return wrap(applyInlineFormat(el, inner), "", "");
  if (tag === "I" || tag === "EM") return wrap(applyInlineFormat(el, inner), "", "");
  if (tag === "U") return wrap(applyInlineFormat(el, inner), "", "");
  if (tag === "LI") return `<li>${applyInlineFormat(el, inner)}</li>`;
  if (tag === "UL") return wrap(inner, "<ul>", "</ul>");
  if (tag === "OL") {
    const items = Array.from(el.children)
      .map((child) => serialize(child))
      .join("");
    return items ? `<ul>${items}</ul>` : inner;
  }
  if (tag === "A") {
    const href = sanitizeHref(el.getAttribute("href"));
    const body = applyInlineFormat(el, inner);
    return href ? `<a href="${escapeText(href)}">${body}</a>` : body;
  }
  if (tag === "SPAN" || tag === "FONT") {
    return applyInlineFormat(el, inner);
  }
  if (tag === "P") {
    return asParagraph(applyInlineFormat(el, inner));
  }
  if (tag === "H2") {
    const body = applyInlineFormat(el, inner).trim();
    return body ? `<h2>${body}</h2>` : "";
  }
  if (tag === "H3") {
    const body = applyInlineFormat(el, inner).trim();
    return body ? `<h3>${body}</h3>` : "";
  }
  if (
    tag === "DIV" ||
    tag === "H1" ||
    tag === "H4" ||
    tag === "BLOCKQUOTE" ||
    tag === "SECTION" ||
    tag === "ARTICLE"
  ) {
    const formatted = applyInlineFormat(el, inner);
    if (!formatted.trim()) return "";
    if (/^<(p|ul|li)\b/i.test(formatted.trim())) return formatted;
    return asParagraph(formatted);
  }
  return applyInlineFormat(el, inner);
}

function parseRoot(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(
    `<div id="__insight_root__">${html}</div>`,
    "text/html"
  );
  return doc.getElementById("__insight_root__");
}

/** 붙여넣기·정리용. style/class/폰트 등 제거 후 허용 태그만 남긴다. */
export function sanitizeInsightHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const root = parseRoot(trimmed);
  if (!root) {
    return escapeText(trimmed.replace(/<[^>]+>/g, ""));
  }
  const out = serializeChildren(root)
    .replace(/(<p>\s*<\/p>)+/gi, "")
    .replace(/^(<br\s*\/?>)+/gi, "")
    .replace(/(<br\s*\/?>)+$/gi, "")
    .trim();
  if (!out) return "";
  if (/^<(p|ul)\b/i.test(out)) return out;
  return asParagraph(out);
}

export function insightPlainToHtml(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((para) => asParagraph(escapeText(para).replace(/\n/g, "<br>")))
    .join("");
}

export function insightLooksLikeHtml(value: string): boolean {
  return /<(p|b|i|u|br|ul|ol|li|a|span|strong|em|div|h[1-6]|font)\b/i.test(value);
}

export function insightToEditorHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (insightLooksLikeHtml(value)) return sanitizeInsightHtml(value);
  return insightPlainToHtml(value);
}
