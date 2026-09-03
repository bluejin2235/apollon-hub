const PALETTE = [
  "#0f172a",
  "#b0231e",
  "#a35a08",
  "#0f7a45",
  "#534ab7"
] as const;

export const LEAD_COLORS = PALETTE;

/** 워크 기본 설명 — 공개 content__body 와 맞춤 */
export const LEAD_KO_LIMIT = 500;
export const LEAD_EN_LIMIT = 1000;

const COLOR_SET = new Set<string>(PALETTE);

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeLeadColor(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\s+/g, "");
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let next = hex[1] ?? "";
    if (next.length === 3) {
      next = next
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    const full = `#${next}`;
    return COLOR_SET.has(full) ? full : null;
  }
  const rgb = raw.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (rgb) {
    const full = rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
    return COLOR_SET.has(full) ? full : null;
  }
  return null;
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

function wrap(inner: string, open: string, close: string): string {
  return inner ? `${open}${inner}${close}` : "";
}

function isElem(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isBlockTag(tag: string): boolean {
  return (
    tag === "P" ||
    tag === "DIV" ||
    tag === "H1" ||
    tag === "H2" ||
    tag === "H3" ||
    tag === "H4" ||
    tag === "BLOCKQUOTE" ||
    tag === "SECTION" ||
    tag === "ARTICLE"
  );
}

function isBoldStyle(style: string): boolean {
  return (
    /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || /\bfont:[^;]*\bbold\b/i.test(style)
  );
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

function asParagraph(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return "<p><br></p>";
  return `<p>${trimmed}</p>`;
}

function serializeChildren(el: HTMLElement): string {
  return Array.from(el.childNodes)
    .map((node) => serialize(node))
    .join("");
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
  if (tag === "B" || tag === "STRONG" || tag === "I" || tag === "EM" || tag === "U") {
    return applyInlineFormat(el, inner);
  }
  if (isBlockTag(tag)) {
    const formatted = applyInlineFormat(el, inner);
    if (!formatted.trim()) return "<p><br></p>";
    if (/^<(p|ul)\b/i.test(formatted.trim())) return formatted;
    return asParagraph(formatted);
  }
  return applyInlineFormat(el, inner);
}

function parseRoot(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(
    `<div id="__lead_root__">${html}</div>`,
    "text/html"
  );
  return doc.getElementById("__lead_root__");
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
  const trimmed = html.trim();
  if (!trimmed) return "";
  const root = parseRoot(trimmed);
  if (!root) {
    return escapeText(trimmed.replace(/<[^>]+>/g, ""));
  }
  const out = serializeChildren(root)
    .replace(/(<p>\s*<br\s*\/?>\s*<\/p>)+/gi, (m) => m)
    .replace(/^(<br\s*\/?>)+/gi, "")
    .replace(/(<br\s*\/?>)+$/gi, "")
    .trim();
  if (!out) return "";
  if (/^<(p|ul)\b/i.test(out)) return out;
  if (/<br\s*\/?>/i.test(out) && !/<p\b/i.test(out)) {
    return brSeparatedToParagraphs(out);
  }
  return asParagraph(out);
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
