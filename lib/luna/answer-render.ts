import type { LunaCard } from "./tavily";
import { parseAssumeMarkers, parseNumberedChoices } from "./chat-response";
import {
  findAllWorkserverPathSpans,
  groupNasCardsByFolder,
  mergePathGroups,
  splitMarkdownByWorkserverPaths,
  stripFileExtension,
  type MarkdownSegment,
  type WorkserverPathGroup
} from "./nas-path";
import type { NotionSource } from "./notion";

export type ParsedLunaAnswer = {
  markdown: string;
  assumptions: string[];
  segments: MarkdownSegment[];
};

export type LunaResultLayout = {
  lead: string;
  nasGroups: WorkserverPathGroup[];
  notionItems: NotionSource[];
  body: string;
  assume: string[];
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

function notionDateKey(title: string): number {
  const m = title.trim().match(/^(\d{6})/);
  return m ? Number(m[1]) : 0;
}

function sortNotionItems(items: NotionSource[]): NotionSource[] {
  return [...items].sort((a, b) => notionDateKey(b.title) - notionDateKey(a.title));
}

function nasCardsFromMeta(cards: LunaCard[]): LunaCard[] {
  return cards.filter((c) => c.type === "nas");
}

function starredNasCards(cards: LunaCard[]): LunaCard[] {
  return cards.filter((c) => (c.description ?? "").startsWith("★ "));
}

function nasCardsMentionedInBody(cards: LunaCard[], body: string): LunaCard[] {
  return cards.filter((c) => c.title && body.includes(c.title));
}

function nasGroupsFromBody(markdown: string): WorkserverPathGroup[] {
  try {
    return splitMarkdownByWorkserverPaths(markdown)
      .filter((s): s is Extract<MarkdownSegment, { type: "paths" }> => s.type === "paths")
      .flatMap((s) => s.groups);
  } catch {
    return [];
  }
}

function notionCardsToSources(cards: LunaCard[]): NotionSource[] {
  const out: NotionSource[] = [];
  for (const c of cards) {
    if (c.type !== "notion" || !c.url || !c.title) continue;
    out.push({ title: c.title, url: c.url, id: c.url });
  }
  return out;
}

function isResultSectionHeading(line: string): boolean {
  const t = line.replace(/\*/g, "").trim();
  if (/^Work서버\b/.test(t)) return true;
  if (/^노션(\s*\(.*\))?$/.test(t)) return true;
  return false;
}

function collectedFileNames(groups: WorkserverPathGroup[]): Set<string> {
  const names = new Set<string>();
  for (const g of groups) {
    for (const f of g.files) names.add(f);
  }
  return names;
}

function unwrapCatalogLine(line: string): string {
  let t = line.trim().replace(/^[-*•]\s+/, "").replace(/^(?:→|->)\s*/, "");
  if (t.startsWith("`") && t.endsWith("`") && t.length > 2) {
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith("**") && t.endsWith("**") && t.length > 4) {
    t = t.slice(2, -2).trim();
  }
  return t.replace(/\*\*/g, "").replace(/`/g, "").trim();
}

function isFilenameOnlyLine(line: string, files: Set<string>): boolean {
  const t = unwrapCatalogLine(line);
  return files.has(t);
}

function yymmddTokens(text: string): string[] {
  return text.match(/\d{6}/g) ?? [];
}

type CardOverlapTokens = {
  files: Set<string>;
  stems: string[];
  dates: Set<string>;
  phrases: string[];
};

const OVERLAP_FILLER_RE =
  /버전|초안|최종|계약용|제안서|포함|이전|같은|폴더|안에|있는|있어요|있습니다|입니다|보입니다|확인됩니다|관련|기록|페이지|문서|정리본|정리|링크|항목|첫|직전|미팅용|용이자/g;

function collectOverlapTokens(
  nasGroups: WorkserverPathGroup[],
  notionItems: NotionSource[]
): CardOverlapTokens {
  const files = collectedFileNames(nasGroups);
  const stemSet = new Set<string>();
  const dates = new Set<string>();
  const phrases: string[] = [];

  for (const name of files) {
    const stem = stripFileExtension(name);
    if (stem) stemSet.add(stem);
    for (const d of yymmddTokens(name)) dates.add(d);
  }
  for (const g of nasGroups) {
    for (const d of yymmddTokens(g.folderRawPath)) dates.add(d);
    const leaf = g.folderRawPath.split("\\").pop()?.trim() ?? "";
    if (leaf.length >= 4) phrases.push(leaf);
  }
  for (const page of notionItems) {
    if (!page.title) continue;
    phrases.push(page.title);
    for (const d of yymmddTokens(page.title)) dates.add(d);
  }

  const stems = Array.from(stemSet).sort((a, b) => b.length - a.length);
  phrases.sort((a, b) => b.length - a.length);
  return { files, stems, dates, phrases };
}

function significantAfterOverlapStrip(
  plain: string,
  tokens: CardOverlapTokens
): string {
  let t = plain;
  for (const f of tokens.files) t = t.split(f).join(" ");
  for (const s of tokens.stems) t = t.split(s).join(" ");
  for (const p of tokens.phrases) t = t.split(p).join(" ");
  for (const d of tokens.dates) t = t.split(d).join(" ");
  t = t.replace(/노션/g, " ");
  t = t.replace(OVERLAP_FILLER_RE, " ");
  t = t.replace(/\.[a-z0-9]{1,8}\b/gi, " ");
  t = t.replace(/[^\w가-힣]+/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

function isNotionPointerLine(plain: string): boolean {
  if (!/노션/.test(plain)) return false;
  return significantAfterOverlapStrip(plain, {
    files: new Set(),
    stems: [],
    dates: new Set(),
    phrases: []
  }).length <= 2;
}

function isCardOverlapLine(
  line: string,
  tokens: CardOverlapTokens,
  hasNotion: boolean
): boolean {
  const plain = unwrapCatalogLine(line);
  if (!plain) return true;
  if (isResultSectionHeading(plain)) return true;
  if (tokens.files.has(plain) || tokens.stems.includes(plain)) return true;
  for (const f of tokens.files) {
    if (plain.includes(f)) return true;
  }
  for (const s of tokens.stems) {
    if (s.length >= 8 && plain.includes(s)) return true;
  }
  for (const d of tokens.dates) {
    if (plain.includes(d)) return true;
  }
  if (hasNotion && isNotionPointerLine(plain)) return true;
  return significantAfterOverlapStrip(plain, tokens).length < 8;
}

function stripCardOverlapBody(
  body: string,
  nasGroups: WorkserverPathGroup[],
  notionItems: NotionSource[]
): string {
  if (!body.trim()) return "";
  if (nasGroups.length === 0 && notionItems.length === 0) return body;
  const tokens = collectOverlapTokens(nasGroups, notionItems);
  const hasNotion = notionItems.length > 0;
  const kept: string[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) {
      kept.push("");
      continue;
    }
    if (isCardOverlapLine(line, tokens, hasNotion)) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripOfficePaths(text: string): string {
  const spans = findAllWorkserverPathSpans(text);
  if (spans.length === 0) return text;
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start);
    last = span.end;
  }
  out += text.slice(last);
  return out;
}

export function stripResultArtifacts(
  markdown: string,
  nasGroups: WorkserverPathGroup[],
  notionItems: NotionSource[]
): string {
  let text = stripOfficePaths(markdown);
  text = stripNotionLinksFromMarkdown(text);
  for (const page of notionItems) {
    if (page.title) {
      text = text.split(page.title).join("");
    }
  }
  const files = collectedFileNames(nasGroups);
  const kept: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }
    if (isResultSectionHeading(trimmed)) continue;
    if (isFilenameOnlyLine(trimmed, files)) continue;
    if (/^[-*•]\s*$/.test(trimmed)) continue;
    if (/^(?:→|->)\s*$/.test(trimmed)) continue;
    kept.push(line.replace(/^(?:→|->)\s*/, ""));
  }
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLeadAndBody(text: string): { lead: string; body: string } {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return { lead: "", body: "" };
  return { lead: paras[0] ?? "", body: paras.slice(1).join("\n\n") };
}

export function composeLunaResultLayout(opts: {
  raw: string;
  cards?: LunaCard[] | null;
  notionSources?: NotionSource[] | null;
}): LunaResultLayout {
  const numbered = parseNumberedChoices(opts.raw);
  const base = numbered ? numbered.body : opts.raw;
  const { body: withoutAssume, assumptions } = parseAssumeMarkers(base);

  const allNas = nasCardsFromMeta(opts.cards ?? []);
  const starred = starredNasCards(allNas);
  const mentioned = nasCardsMentionedInBody(allNas, withoutAssume);

  let nasFromMeta: WorkserverPathGroup[] = [];
  if (starred.length > 0) {
    nasFromMeta = groupNasCardsByFolder(starred);
  } else if (mentioned.length > 0) {
    nasFromMeta = groupNasCardsByFolder(mentioned);
  }

  const nasFromBody = nasGroupsFromBody(withoutAssume);
  const nasGroups = mergePathGroups([...nasFromMeta, ...nasFromBody]);

  const notionItems = sortNotionItems(
    mergeNotionSources(
      opts.notionSources,
      mergeNotionSources(
        notionCardsToSources(opts.cards ?? []),
        extractNotionPagesFromMarkdown(withoutAssume)
      )
    )
  );

  const stripped = stripResultArtifacts(withoutAssume, nasGroups, notionItems);

  if (nasGroups.length === 0 && notionItems.length === 0) {
    return {
      lead: "",
      nasGroups: [],
      notionItems: [],
      body: stripped || withoutAssume,
      assume: assumptions
    };
  }

  const { lead, body } = splitLeadAndBody(stripped);
  return {
    lead,
    nasGroups,
    notionItems,
    body: stripCardOverlapBody(body, nasGroups, notionItems),
    assume: assumptions
  };
}

/** @deprecated parseLunaAnswer 사용 */
export function prepareLunaAnswerMarkdown(raw: string): {
  markdown: string;
  assumptions: string[];
} {
  const parsed = parseLunaAnswer(raw);
  return { markdown: parsed.markdown, assumptions: parsed.assumptions };
}
