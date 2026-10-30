/** 프로필 기반 HTML 정리기. DOM 경로와 정규식 경로가 같은 트리를 직렬화한다. */

export const PALETTE = ["#0f172a", "#b0231e", "#a35a08", "#0f7a45", "#534ab7"] as const;
export const COLOR_SET = new Set<string>(PALETTE);

export type HtmlSanitizeProfile = "full" | "basic";

export type SanitizeRichHtmlOptions = {
  /** basic 전용. 기본은 ol 유지. lead 는 ul. */
  ol?: "ul" | "keep";
  /** basic 전용. 기본은 img 유지. lead 는 없음. */
  allowImg?: boolean;
  /** basic 전용. 기본은 제목을 p 로 누름. 이슈는 keep. full 은 무시. */
  headings?: "keep" | "flatten";
};

type EngineConfig = {
  profile: HtmlSanitizeProfile;
  headings: "keep" | "flatten";
  allowClass: boolean;
  allowSupSub: boolean;
  colorMode: "free" | "palette";
  ol: "ul" | "keep";
  allowImg: boolean;
  emptyBlock: "drop" | "br";
  catchPlain: boolean;
};

type TextNode = { type: "text"; value: string };
type ElementNode = {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
};
type HtmlNode = TextNode | ElementNode;

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const CLOSES_P = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "div",
  "table",
  "blockquote",
  "section",
  "article",
  "pre",
  "hr",
]);

const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "span",
  "font",
  "a",
  "sup",
  "sub",
  "br",
]);

const INDENT_CLASSES = ["in-1", "in-2", "in-3", "in-4"] as const;
const BLOCK_CLASSES: Record<"p" | "h2" | "h3", ReadonlySet<string>> = {
  p: new Set<string>(["sz-lg", "sz-sm", ...INDENT_CLASSES]),
  h2: new Set<string>(["is-big", ...INDENT_CLASSES]),
  h3: new Set<string>(INDENT_CLASSES),
};

function resolveConfig(
  profile: HtmlSanitizeProfile,
  options?: SanitizeRichHtmlOptions,
): EngineConfig {
  if (profile === "full") {
    return {
      profile,
      headings: "keep",
      allowClass: true,
      allowSupSub: true,
      colorMode: "free",
      ol: "ul",
      allowImg: false,
      emptyBlock: "drop",
      catchPlain: true,
    };
  }
  return {
    profile,
    headings: options?.headings ?? "flatten",
    allowClass: false,
    allowSupSub: false,
    colorMode: "palette",
    ol: options?.ol ?? "keep",
    allowImg: options?.allowImg ?? true,
    emptyBlock: "br",
    catchPlain: false,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** 인사이트(full) 색. 형식만 검사하고 팔레트 제한은 없다. */
export function normalizePaletteColor(value: string): string | null {
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
    return `#${next}`;
  }
  const rgb = raw.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    if (![r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
    return rgbToHex(r, g, b);
  }
  return null;
}

function profileColor(value: string, mode: EngineConfig["colorMode"]): string | null {
  const hit = normalizePaletteColor(value);
  if (!hit) return null;
  if (mode === "palette") return COLOR_SET.has(hit) ? hit : null;
  return hit;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function wrap(inner: string, open: string, close: string): string {
  return inner ? `${open}${inner}${close}` : "";
}

function allowedClassAttr(tag: "p" | "h2" | "h3", raw: string | null | undefined): string {
  if (!raw) return "";
  const allowed = BLOCK_CLASSES[tag];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const name of raw.trim().split(/\s+/)) {
    if (!name || !allowed.has(name) || seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept.length > 0 ? ` class="${kept.join(" ")}"` : "";
}

function openBlockTag(
  tag: "p" | "h2" | "h3",
  classRaw: string | null | undefined,
  cfg: EngineConfig,
): string {
  if (!cfg.allowClass) return `<${tag}>`;
  return `<${tag}${allowedClassAttr(tag, classRaw)}>`;
}

function isVisuallyEmptyHtml(inner: string): boolean {
  return !inner
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function asParagraph(
  inner: string,
  classRaw: string | null | undefined,
  cfg: EngineConfig,
): string {
  if (cfg.emptyBlock === "drop") {
    if (isVisuallyEmptyHtml(inner)) return "";
    return `${openBlockTag("p", classRaw, cfg)}${inner.trim()}</p>`;
  }
  const trimmed = inner.trim();
  if (!trimmed) return "<p><br></p>";
  return `<p>${trimmed}</p>`;
}

function isBoldStyle(style: string): boolean {
  return (
    /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || /\bfont:[^;]*\bbold\b/i.test(style)
  );
}

function sanitizeHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href) return null;
  if (/^javascript:/i.test(href)) return null;
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) return href;
  return null;
}

function sanitizeMediaSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const src = raw.trim();
  if (!src) return null;
  if (/^javascript:/i.test(src)) return null;
  if (/^(https?:|\/)/i.test(src)) return src;
  return null;
}

function colorFromAttrs(
  attrs: Record<string, string>,
  mode: EngineConfig["colorMode"],
): string | null {
  const style = attrs.style ?? "";
  const color = style.match(/color\s*:\s*([^;]+)/i);
  if (color) {
    const hit = profileColor(color[1] ?? "", mode);
    if (hit) return hit;
  }
  if (attrs.color) return profileColor(attrs.color, mode);
  return null;
}

function applyInlineFormat(el: ElementNode, inner: string, cfg: EngineConfig): string {
  const style = el.attrs.style ?? "";
  const tag = el.tag;
  const color = colorFromAttrs(el.attrs, cfg.colorMode);
  let next = inner;
  if (tag === "b" || tag === "strong" || isBoldStyle(style)) {
    next = wrap(next, "<b>", "</b>");
  }
  if (tag === "i" || tag === "em" || /font-style\s*:\s*italic/i.test(style)) {
    next = wrap(next, "<i>", "</i>");
  }
  if (tag === "u" || /text-decoration[^;]*underline/i.test(style)) {
    next = wrap(next, "<u>", "</u>");
  }
  if (color && next) return `<span style="color:${color}">${next}</span>`;
  return next;
}

function alreadyBlockRe(cfg: EngineConfig): RegExp {
  if (cfg.profile === "full") return /^<(p|ul|h[23]|li)\b/i;
  const tags = ["p", "ul"];
  if (cfg.ol === "keep") tags.push("ol");
  if (cfg.allowImg) tags.push("img");
  if (cfg.headings === "keep") tags.push("h2", "h3");
  return new RegExp(`^<(${tags.join("|")})\\b`, "i");
}

function finishStartRe(cfg: EngineConfig): RegExp {
  if (cfg.profile === "full") return /^<(p|ul|h[23])\b/i;
  const tags = ["p", "ul"];
  if (cfg.ol === "keep") tags.push("ol");
  if (cfg.allowImg) tags.push("img");
  if (cfg.headings === "keep") tags.push("h2", "h3");
  return new RegExp(`^<(${tags.join("|")})\\b`, "i");
}

function isBlockTag(tag: string, cfg: EngineConfig): boolean {
  if (tag === "p" || tag === "div" || tag === "h1" || tag === "h4") return true;
  if (tag === "blockquote" || tag === "section" || tag === "article") return true;
  if ((tag === "h2" || tag === "h3") && cfg.headings === "flatten") return true;
  return false;
}

function serializeChildren(el: ElementNode, cfg: EngineConfig): string {
  return el.children.map((node) => serializeNode(node, cfg)).join("");
}

function serializeNode(node: HtmlNode, cfg: EngineConfig): string {
  if (node.type === "text") {
    return escapeText(node.value.replace(/\u200B/g, ""));
  }

  const el = node;
  const tag = el.tag;
  const inner = serializeChildren(el, cfg);

  if (tag === "br") return "<br>";
  if (tag === "img") {
    if (!cfg.allowImg) return "";
    const src = sanitizeMediaSrc(el.attrs.src);
    if (!src) return "";
    const alt = escapeText(el.attrs.alt ?? "").replace(/"/g, "&quot;");
    return `<img src="${escapeText(src)}" alt="${alt}">`;
  }
  if (tag === "sup") {
    if (!cfg.allowSupSub) return applyInlineFormat(el, inner, cfg);
    return wrap(applyInlineFormat(el, inner, cfg), "<sup>", "</sup>");
  }
  if (tag === "sub") {
    if (!cfg.allowSupSub) return applyInlineFormat(el, inner, cfg);
    return wrap(applyInlineFormat(el, inner, cfg), "<sub>", "</sub>");
  }
  if (tag === "b" || tag === "strong" || tag === "i" || tag === "em" || tag === "u") {
    return applyInlineFormat(el, inner, cfg);
  }
  if (tag === "li") return `<li>${applyInlineFormat(el, inner, cfg)}</li>`;
  if (tag === "ul") return wrap(inner, "<ul>", "</ul>");
  if (tag === "ol") {
    const items = el.children
      .filter((child): child is ElementNode => child.type === "element")
      .map((child) => serializeNode(child, cfg))
      .join("");
    const listTag = cfg.ol === "keep" ? "ol" : "ul";
    return items ? `<${listTag}>${items}</${listTag}>` : inner;
  }
  if (tag === "a") {
    const href = sanitizeHref(el.attrs.href);
    const body = applyInlineFormat(el, inner, cfg);
    return href ? `<a href="${escapeText(href)}">${body}</a>` : body;
  }
  if (tag === "span") {
    const formatted = applyInlineFormat(el, inner, cfg);
    if (!formatted) return "";
    if (colorFromAttrs(el.attrs, cfg.colorMode)) return formatted;
    return `<span>${formatted}</span>`;
  }
  if (tag === "font") {
    return applyInlineFormat(el, inner, cfg);
  }
  if (tag === "h2" || tag === "h3") {
    if (cfg.headings === "keep") {
      const body = applyInlineFormat(el, inner, cfg).trim();
      return body && !isVisuallyEmptyHtml(body)
        ? `${openBlockTag(tag, el.attrs.class, cfg)}${body}</${tag}>`
        : "";
    }
  }
  if (tag === "p") {
    return asParagraph(applyInlineFormat(el, inner, cfg), el.attrs.class, cfg);
  }
  if (isBlockTag(tag, cfg)) {
    const formatted = applyInlineFormat(el, inner, cfg);
    if (cfg.emptyBlock === "drop") {
      if (isVisuallyEmptyHtml(formatted)) return "";
      if (alreadyBlockRe(cfg).test(formatted.trim())) return formatted;
      return asParagraph(formatted, undefined, cfg);
    }
    if (!formatted.trim()) return "<p><br></p>";
    if (alreadyBlockRe(cfg).test(formatted.trim())) return formatted;
    return asParagraph(formatted, undefined, cfg);
  }
  return applyInlineFormat(el, inner, cfg);
}

function brSeparatedToParagraphs(html: string, cfg: EngineConfig): string {
  if (cfg.emptyBlock === "drop") {
    return html
      .split(/<br\s*\/?>/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => asParagraph(part, undefined, cfg))
      .join("");
  }
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((part) => part.trim())
    .filter((part, index, arr) => part.length > 0 || (index > 0 && index < arr.length - 1));
  if (parts.length === 0) return "<p><br></p>";
  return parts
    .map((part) => {
      if (!part) return "<p><br></p>";
      if (alreadyBlockRe(cfg).test(part)) return part;
      return `<p>${part}</p>`;
    })
    .join("");
}

function finish(out: string, cfg: EngineConfig): string {
  if (cfg.emptyBlock === "drop") {
    let cleaned = out
      .replace(/<p>(?:\s|<br\s*\/?>|&nbsp;|\u00a0)*<\/p>/gi, "")
      .replace(/^(<br\s*\/?>)+/gi, "")
      .replace(/(<br\s*\/?>)+$/gi, "")
      .trim();
    if (!cleaned) return "";
    if (!/<p\b/i.test(cleaned) && /<br\s*\/?>/i.test(cleaned)) {
      cleaned = brSeparatedToParagraphs(cleaned, cfg);
    }
    cleaned = cleaned.replace(/<p>(?:\s|<br\s*\/?>|&nbsp;|\u00a0)*<\/p>/gi, "").trim();
    if (!cleaned) return "";
    if (finishStartRe(cfg).test(cleaned)) return cleaned;
    return asParagraph(cleaned, undefined, cfg);
  }

  const cleaned = out
    .replace(/^(<br\s*\/?>)+/gi, "")
    .replace(/(<br\s*\/?>)+$/gi, "")
    .trim();
  if (!cleaned) return "";
  if (finishStartRe(cfg).test(cleaned)) return cleaned;
  if (/<br\s*\/?>/i.test(cleaned) && !/<p\b/i.test(cleaned)) {
    return brSeparatedToParagraphs(cleaned, cfg);
  }
  return asParagraph(cleaned, undefined, cfg);
}

function stripDangerousHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(embed|link|meta|base)\b[^>]*\/?>/gi, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, "\u00A0")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null = re.exec(raw);
  while (match) {
    const name = (match[1] ?? "").toLowerCase();
    if (name) {
      attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    match = re.exec(raw);
  }
  return attrs;
}

function closeInlineThenP(stack: ElementNode[]): void {
  while (stack.length > 1) {
    const top = stack[stack.length - 1];
    if (!top) break;
    if (top.tag === "p") {
      stack.pop();
      break;
    }
    if (INLINE_TAGS.has(top.tag) && top.tag !== "br") {
      stack.pop();
      continue;
    }
    break;
  }
}

function closeTag(stack: ElementNode[], tag: string): void {
  for (let i = stack.length - 1; i > 0; i -= 1) {
    if (stack[i]?.tag === tag) {
      stack.length = i;
      return;
    }
  }
}

function parseFragment(html: string): HtmlNode[] {
  const root: ElementNode = { type: "element", tag: "root", attrs: {}, children: [] };
  const stack: ElementNode[] = [root];
  let i = 0;

  while (i < html.length) {
    const parent = stack[stack.length - 1];
    if (!parent) break;

    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const raw = html.slice(i, next < 0 ? html.length : next);
      parent.children.push({ type: "text", value: decodeEntities(raw) });
      i = next < 0 ? html.length : next;
      continue;
    }

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }

    const close = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>/.exec(html.slice(i));
    if (close) {
      closeTag(stack, close[1].toLowerCase());
      i += close[0].length;
      continue;
    }

    const open = /^<([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/.exec(html.slice(i));
    if (!open) {
      parent.children.push({ type: "text", value: "<" });
      i += 1;
      continue;
    }

    const tag = open[1].toLowerCase();
    const attrs = parseAttrs(open[2] ?? "");
    const selfClosing = Boolean(open[3]) || VOID_TAGS.has(tag);
    i += open[0].length;

    if (CLOSES_P.has(tag)) closeInlineThenP(stack);
    if (tag === "li") closeTag(stack, "li");

    const current = stack[stack.length - 1];
    if (!current) break;

    const el: ElementNode = { type: "element", tag, attrs, children: [] };
    current.children.push(el);
    if (!selfClosing) stack.push(el);
  }

  return root.children;
}

function fromDom(node: Node): HtmlNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: "text", value: node.textContent ?? "" };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name.toLowerCase()] = attr.value;
  }
  const children: HtmlNode[] = [];
  for (const child of Array.from(el.childNodes)) {
    const parsed = fromDom(child);
    if (parsed) children.push(parsed);
  }
  return { type: "element", tag: el.tagName.toLowerCase(), attrs, children };
}

function parseRoot(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser()
    .parseFromString(`<div id="__rich_root__">${html}</div>`, "text/html")
    .getElementById("__rich_root__");
}

function nodesFromHtml(html: string): HtmlNode[] {
  const root = parseRoot(html);
  if (root) {
    return Array.from(root.childNodes)
      .map((child) => fromDom(child))
      .filter((node): node is HtmlNode => node !== null);
  }
  return parseFragment(html);
}

function plainToParagraphs(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((para) => {
      const inner = escapeText(para).replace(/\n/g, "<br>");
      return inner.trim() ? `<p>${inner.trim()}</p>` : "";
    })
    .join("");
}

export function sanitizeRichHtml(
  html: string,
  profile: HtmlSanitizeProfile,
  options?: SanitizeRichHtmlOptions,
): string {
  const cfg = resolveConfig(profile, options);
  const trimmed = html.trim();
  if (!trimmed) return "";
  try {
    const stripped = stripDangerousHtml(trimmed);
    const nodes = nodesFromHtml(stripped);
    return finish(nodes.map((node) => serializeNode(node, cfg)).join(""), cfg);
  } catch {
    const strippedTags = trimmed.replace(/<[^>]+>/g, "");
    return cfg.catchPlain ? plainToParagraphs(strippedTags) : strippedTags;
  }
}
