import { LEAD_COLORS, leadToEditorHtml, normalizeLeadColor } from "@/lib/website/lead-html";

const COLOR_SET = new Set<string>(LEAD_COLORS);

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeHref(raw: string | null): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href) return null;
  if (/^javascript:/i.test(href)) return null;
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
  return null;
}

function sanitizeMediaSrc(raw: string | null): string | null {
  if (!raw) return null;
  const src = raw.trim();
  if (!src) return null;
  if (/^javascript:/i.test(src)) return null;
  if (/^(https?:|\/)/i.test(src)) return src;
  return null;
}

function wrap(inner: string, open: string, close: string): string {
  return inner ? `${open}${inner}${close}` : "";
}

function isElem(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

function colorFromElement(el: Element): string | null {
  const style = el.getAttribute("style") ?? "";
  const color = style.match(/color\s*:\s*([^;]+)/i);
  if (color) {
    const hit = normalizeLeadColor(color[1] ?? "");
    if (hit && COLOR_SET.has(hit)) return hit;
  }
  const attr = el.getAttribute("color");
  if (attr) return normalizeLeadColor(attr);
  return null;
}

function isBoldStyle(style: string): boolean {
  return (
    /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || /\bfont:[^;]*\bbold\b/i.test(style)
  );
}

function applyInlineFormat(el: HTMLElement, inner: string): string {
  const style = el.getAttribute("style") ?? "";
  const tag = el.tagName;
  const color = colorFromElement(el);
  const mention = el.classList.contains("mention");
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
  if (mention && next) {
    return `<span class="mention">${next.startsWith("@") ? next : `@${next}`}</span>`;
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
  if (tag === "IMG") {
    const src = sanitizeMediaSrc(el.getAttribute("src"));
    if (!src) return "";
    const alt = escapeText(el.getAttribute("alt") ?? "");
    return `<img src="${escapeText(src)}" alt="${alt}">`;
  }
  if (tag === "VIDEO") {
    const src = sanitizeMediaSrc(el.getAttribute("src"));
    if (!src) return inner;
    return `<video src="${escapeText(src)}" controls></video>`;
  }
  if (tag === "LI") return `<li>${applyInlineFormat(el, inner)}</li>`;
  if (tag === "UL") return wrap(inner, "<ul>", "</ul>");
  if (tag === "OL") return wrap(inner, "<ol>", "</ol>");
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
  if (tag === "H2") return wrap(applyInlineFormat(el, inner), "<h2>", "</h2>");
  if (tag === "H3") return wrap(applyInlineFormat(el, inner), "<h3>", "</h3>");
  if (
    tag === "P" ||
    tag === "DIV" ||
    tag === "H1" ||
    tag === "H4" ||
    tag === "BLOCKQUOTE" ||
    tag === "SECTION" ||
    tag === "ARTICLE"
  ) {
    const formatted = applyInlineFormat(el, inner);
    if (!formatted.trim()) return "<p><br></p>";
    if (/^<(p|ul|ol|h2|h3|img|video)\b/i.test(formatted.trim())) return formatted;
    return asParagraph(formatted);
  }
  return applyInlineFormat(el, inner);
}

function parseRoot(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(
    `<div id="__issue_root__">${html}</div>`,
    "text/html"
  );
  return doc.getElementById("__issue_root__");
}

function stripDangerous(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/javascript:/gi, "");
}

/** 문의 본문·댓글. 이미지·영상·링크·@부름을 남긴다. */
export function sanitizeIssueHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const root = parseRoot(trimmed);
  if (!root) return stripDangerous(trimmed);
  const out = serializeChildren(root).trim();
  if (!out) return "";
  if (/^<(p|ul|ol|h2|h3|img|video)\b/i.test(out)) return out;
  return asParagraph(out);
}

export function issueToEditorHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "<p><br></p>";
  if (/<(p|b|i|u|br|ul|ol|li|a|span|strong|em|img|video|h[1-6]|div)\b/i.test(text)) {
    const clean = sanitizeIssueHtml(text);
    return clean || "<p><br></p>";
  }
  return leadToEditorHtml(text);
}

export function issuePlainText(html: string): string {
  return sanitizeIssueHtml(html)
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

export function issueIsEmpty(html: string): boolean {
  return issuePlainText(html).replace(/\s+/g, "").length === 0;
}

export function wrapMentionNames(html: string, names: string[]): string {
  const sorted = [...names]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return html;
  return html.replace(/@([^\s<@]+)/g, (full, raw: string) => {
    const hit = sorted.find((name) => raw === name || raw.startsWith(name));
    if (!hit) return full;
    const rest = raw.slice(hit.length);
    return `<span class="mention">@${hit}</span>${rest}`;
  });
}

export function mentionedNames(html: string, names: string[]): string[] {
  const text = issuePlainText(html);
  const found = new Set<string>();
  const sorted = [...names]
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (text.includes(`@${name}`)) found.add(name);
  }
  const mentionRe = /<span class="mention">@([^<]+)<\/span>/g;
  let match: RegExpExecArray | null = mentionRe.exec(html);
  while (match) {
    const name = match[1]?.trim();
    if (name) found.add(name);
    match = mentionRe.exec(html);
  }
  return [...found];
}
