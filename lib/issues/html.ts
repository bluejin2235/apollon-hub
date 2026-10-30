import { leadToEditorHtml } from "@/lib/website/lead-html";
import { sanitizeRichHtml } from "@/lib/website/rich-html";

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attrValue(attrs: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = re.exec(attrs);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function safeMediaSrc(raw: string): string {
  const src = raw.trim();
  if (!src || /^javascript:/i.test(src)) return "";
  if (!/^(https?:|\/)/i.test(src)) return "";
  return src;
}

/** 문의 본문·댓글. 표준(full) + 이미지·영상·멘션·번호목록. */
export function sanitizeIssueHtml(html: string): string {
  const mentions: string[] = [];
  const videos: string[] = [];
  const images: { src: string; alt: string }[] = [];
  const lists: string[] = [];
  const prepared = html
    .replace(/<span\s+([^>]*class=["'][^"']*\bmention\b[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi, (_, _attrs, inner: string) => {
      const i = mentions.length;
      const body = String(inner);
      mentions.push(body.startsWith("@") ? body : `@${body}`);
      return `⟦ISSUE_MENTION_${i}⟧`;
    })
    .replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (_full, attrs: string, inner: string) => {
      const src = safeMediaSrc(attrValue(attrs, "src"));
      if (!src) return inner;
      const i = videos.length;
      videos.push(src);
      return `<img src="${src}" alt="__ISSUE_VIDEO_${i}__">`;
    })
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_full, inner: string) => {
      const i = lists.length;
      lists.push(String(inner));
      return `⟦ISSUE_OL_${i}⟧`;
    })
    .replace(/<img\b([^>]*)\/?>/gi, (_full, attrs: string) => {
      const src = safeMediaSrc(attrValue(attrs, "src"));
      if (!src) return "";
      const i = images.length;
      images.push({ src, alt: attrValue(attrs, "alt") });
      return `⟦ISSUE_IMG_${i}⟧`;
    });

  let out = sanitizeRichHtml(prepared, "full");

  out = out.replace(/(?:<p>)?⟦ISSUE_OL_(\d+)⟧(?:<\/p>)?/g, (_, idx: string) => {
    const inner = lists[Number(idx)] ?? "";
    const cleaned = sanitizeRichHtml(`<ul>${inner}</ul>`, "full");
    return cleaned.replace(/^<ul>/i, "<ol>").replace(/<\/ul>$/i, "</ol>");
  });
  out = out.replace(/(?:<p>)?⟦ISSUE_IMG_(\d+)⟧(?:<\/p>)?/g, (_, idx: string) => {
    const item = images[Number(idx)];
    if (!item) return "";
    const alt = escapeText(item.alt).replace(/"/g, "&quot;");
    return `<img src="${escapeText(item.src)}" alt="${alt}">`;
  });
  out = out.replace(/<img src="([^"]*)" alt="__ISSUE_VIDEO_(\d+)__">/g, (_, src: string, idx: string) => {
    const original = videos[Number(idx)] ?? src;
    return `<video src="${escapeText(original)}" controls></video>`;
  });
  out = out.replace(/⟦ISSUE_MENTION_(\d+)⟧/g, (_, idx: string) => {
    const body = mentions[Number(idx)];
    if (!body) return "";
    return `<span class="mention">${body}</span>`;
  });
  return out;
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
