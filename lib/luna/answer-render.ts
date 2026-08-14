import { parseAssumeMarkers, parseNumberedChoices } from "./chat-response";
import {
  splitMarkdownByWorkserverPaths,
  type MarkdownSegment
} from "./nas-path";
import type { NotionSource } from "./notion";

export type ParsedLunaAnswer = {
  markdown: string;
  assumptions: string[];
  segments: MarkdownSegment[];
};

export function parseLunaAnswer(raw: string): ParsedLunaAnswer {
  const numbered = parseNumberedChoices(raw);
  const base = numbered ? numbered.body : raw;
  const { body, assumptions } = parseAssumeMarkers(base);
  const markdown = body || (assumptions.length === 0 ? raw : "");
  let segments: MarkdownSegment[];
  try {
    segments = markdown
      ? splitMarkdownByWorkserverPaths(markdown)
      : [];
  } catch (err) {
    console.warn("[luna-render] path split failed", err);
    segments = markdown ? [{ type: "text", value: markdown }] : [];
  }
  return { markdown, assumptions, segments };
}

function isNotionUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return (
      host === "notion.so" ||
      host === "notion.site" ||
      host === "app.notion.com"
    );
  } catch {
    return false;
  }
}

function normalizeNotionUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.search = "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s)>\]]+/g;

export function extractNotionPagesFromMarkdown(
  markdown: string
): NotionSource[] {
  const pages: NotionSource[] = [];
  const seen = new Set<string>();
  const md = markdown.replace(/\r\n/g, "\n");

  for (const m of md.matchAll(MD_LINK_RE)) {
    const title = (m[1] ?? "").trim();
    const url = (m[2] ?? "").trim();
    if (!title || !url || !isNotionUrl(url)) continue;
    const key = normalizeNotionUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({ title, url, id: key });
  }

  for (const m of md.matchAll(BARE_URL_RE)) {
    const url = (m[0] ?? "").replace(/[.,;:]+$/, "").trim();
    if (!isNotionUrl(url)) continue;
    const key = normalizeNotionUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({ title: url, url, id: key });
  }

  return pages;
}

export function stripNotionLinksFromMarkdown(markdown: string): string {
  return markdown
    .replace(MD_LINK_RE, (full, _title: string, url: string) =>
      isNotionUrl(url) ? "" : full
    )
    .replace(BARE_URL_RE, (url) => (isNotionUrl(url) ? "" : url))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mergeNotionSources(
  fromMeta: NotionSource[] | null | undefined,
  fromMarkdown: NotionSource[]
): NotionSource[] {
  const out: NotionSource[] = [];
  const seen = new Set<string>();
  for (const src of [...(fromMeta ?? []), ...fromMarkdown]) {
    if (!src.title || !src.url) continue;
    const key = normalizeNotionUrl(src.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(src);
  }
  return out;
}

/** @deprecated parseLunaAnswer 사용 */
export function prepareLunaAnswerMarkdown(raw: string): {
  markdown: string;
  assumptions: string[];
} {
  const parsed = parseLunaAnswer(raw);
  return { markdown: parsed.markdown, assumptions: parsed.assumptions };
}

