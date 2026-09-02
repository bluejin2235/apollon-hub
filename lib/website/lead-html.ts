const PALETTE = [
  "#0f172a",
  "#b0231e",
  "#a35a08",
  "#0f7a45",
  "#534ab7"
] as const;

export const LEAD_COLORS = PALETTE;

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
    tag === "SECTION"
  );
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
  const nodes = Array.from(el.childNodes);
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const nextNode = nodes[i + 1];
    const chunk = serialize(node);
    const block = isElem(node) && isBlockTag(node.tagName);
    const emptyBlock = block && (!chunk || chunk === "<br>");
    const nextBlock = Boolean(nextNode && isElem(nextNode) && isBlockTag(nextNode.tagName));
    const nextBr = Boolean(nextNode && isElem(nextNode) && nextNode.tagName === "BR");
    const nextInline = Boolean(nextNode) && !nextBlock && !nextBr;

    if (emptyBlock) {
      if (out && !out.endsWith("<br>")) out += "<br>";
      out += "<br>";
      continue;
    }
    if (block && out && !out.endsWith("<br>")) {
      out += "<br>";
    }
    out += chunk;
    if (block && nextInline && !out.endsWith("<br>")) {
      out += "<br>";
    }
  }
  return out;
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText((node.textContent ?? "").replace(/\u200B/g, ""));
  }
  if (!isElem(node)) {
    return "";
  }
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
  if (isBlockTag(tag)) {
    const formatted = applyInlineFormat(el, inner);
    if (!formatted) return "<br>";
    return formatted;
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

/** 허용 태그만 남긴 기본 설명 HTML. b · i · u · br · ul · li · span(색만) */
export function sanitizeLeadHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const root = parseRoot(trimmed);
  if (!root) {
    return trimmed.replace(/<[^>]+>/g, "");
  }
  return serializeChildren(root)
    .replace(/^(<br>)+/g, "")
    .replace(/(<br>)+$/g, "")
    .trim();
}

export function leadPlainText(html: string): string {
  return sanitizeLeadHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ");
}

export function leadCharCount(html: string): number {
  return leadPlainText(html).length;
}

export function leadToEditorHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (leadLooksLikeHtml(value)) return sanitizeLeadHtml(value);
  return escapeText(value).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

export function leadIsEmpty(html: string): boolean {
  return leadCharCount(html) === 0;
}

export function leadLooksLikeHtml(value: string): boolean {
  return /<(b|i|u|br|ul|ol|li|span|strong|em|font|p|div)\b/i.test(value);
}
