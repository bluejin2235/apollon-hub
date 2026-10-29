/** 인사이트 글 블록 붙여넣기 살균. 허용: b · i · u · br · p · h2 · h3 · ul · li · a(href) · span(글자 색) · sup · sub · p/h2/h3 class(화이트리스트) */

const INSIGHT_INDENT_CLASSES = ["in-1", "in-2", "in-3", "in-4"] as const;
const INSIGHT_BLOCK_CLASSES: Record<"p" | "h2" | "h3", ReadonlySet<string>> = {
  p: new Set<string>(["sz-lg", "sz-sm", ...INSIGHT_INDENT_CLASSES]),
  h2: new Set<string>(["is-big", ...INSIGHT_INDENT_CLASSES]),
  h3: new Set<string>(INSIGHT_INDENT_CLASSES)
};

function allowedClassAttr(tag: "p" | "h2" | "h3", raw: string | null | undefined): string {
  if (!raw) return "";
  const allowed = INSIGHT_BLOCK_CLASSES[tag];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const name of raw.trim().split(/\s+/)) {
    if (!name || !allowed.has(name) || seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept.length > 0 ? ` class="${kept.join(" ")}"` : "";
}

function openBlockTag(tag: "p" | "h2" | "h3", classRaw: string | null | undefined): string {
  return `<${tag}${allowedClassAttr(tag, classRaw)}>`;
}

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

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** 3자리 hex 펼치기 · rgb→hex · 소문자 #rrggbb. 팔레트 제한 없음. named/var/주입은 null */
export function normalizeInsightColor(value: string): string | null {
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
    return full;
  }
  const rgb = raw.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (rgb) {
    const full = rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
    return full;
  }
  return null;
}

function colorFromElement(el: Element): string | null {
  const style = el.getAttribute("style") ?? "";
  const color = style.match(/color\s*:\s*([^;]+)/i);
  if (color) {
    const hit = normalizeInsightColor(color[1] ?? "");
    if (hit) return hit;
  }
  const attr = el.getAttribute("color");
  if (attr) return normalizeInsightColor(attr);
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

function isVisuallyEmptyHtml(inner: string): boolean {
  return !inner
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function asParagraph(inner: string, classRaw?: string | null): string {
  if (isVisuallyEmptyHtml(inner)) return "";
  return `${openBlockTag("p", classRaw)}${inner.trim()}</p>`;
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
  if (tag === "SUP") return wrap(applyInlineFormat(el, inner), "<sup>", "</sup>");
  if (tag === "SUB") return wrap(applyInlineFormat(el, inner), "<sub>", "</sub>");
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
    return asParagraph(applyInlineFormat(el, inner), el.getAttribute("class"));
  }
  if (tag === "H2") {
    const body = applyInlineFormat(el, inner).trim();
    return body && !isVisuallyEmptyHtml(body)
      ? `${openBlockTag("h2", el.getAttribute("class"))}${body}</h2>`
      : "";
  }
  if (tag === "H3") {
    const body = applyInlineFormat(el, inner).trim();
    return body && !isVisuallyEmptyHtml(body)
      ? `${openBlockTag("h3", el.getAttribute("class"))}${body}</h3>`
      : "";
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
    if (isVisuallyEmptyHtml(formatted)) return "";
    if (/^<(p|ul|h[23]|li)\b/i.test(formatted.trim())) return formatted;
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
  let out = serializeChildren(root)
    .replace(/<p>(?:\s|<br\s*\/?>|&nbsp;|\u00a0)*<\/p>/gi, "")
    .replace(/^(<br\s*\/?>)+/gi, "")
    .replace(/(<br\s*\/?>)+$/gi, "")
    .trim();
  if (!out) return "";
  if (!/<p\b/i.test(out) && /<br\s*\/?>/i.test(out)) {
    out = out
      .split(/<br\s*\/?>/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => asParagraph(part))
      .join("");
  }
  out = out.replace(/<p>(?:\s|<br\s*\/?>|&nbsp;|\u00a0)*<\/p>/gi, "").trim();
  if (!out) return "";
  if (/^<(p|ul|h[23])\b/i.test(out)) return out;
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
  return /<(p|b|i|u|br|ul|ol|li|a|span|strong|em|div|h[1-6]|font|sup|sub)\b/i.test(value);
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
