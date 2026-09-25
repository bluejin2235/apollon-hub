import { hasPositiveRetrievedEvidence } from "@/lib/luna/failures-shared";
import type { AskedNature, AskedWhat } from "@/lib/luna/ask-what";
import { natureLabelKo } from "@/lib/luna/ask-what";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import { isGarbage3dPath } from "@/lib/luna/media-index-rules";

export type RetrievedBundle = {
  cards: LunaCard[];
  notion: NotionSource[];
  wiki: WikiSourceRef[];
  nas: Array<{ path: string }>;
};

export type FilterCounts = {
  retrieved: number;
  matching: number;
  shown: number;
};

const NATURE_PATH_RE: Record<Exclude<AskedNature, "any">, RegExp> = {
  kv: /(^|\\|\s)kv(\s|,|$|\\)|키비주얼|key\s*visual|영상시뮬레이션/i,
  storyboard: /스토리보드|storyboard|(^|\\)[^\\]*콘티([^\\]|$)/i,
  reference:
    /(^|\\)(?:\d+\s*)?(?:reference|references|referecnces|referneces|refs?|레퍼런스|참고)(?:s)?(?:$|\\)/i,
  quote: /견적/
};

export function natureMatchesPath(path: string, nature: AskedNature): boolean {
  if (nature === "any") return true;
  return NATURE_PATH_RE[nature].test(path);
}

export function pathContainsPhrase(haystack: string, phrase: string): boolean {
  const h = haystack.replace(/\//g, "\\").toLowerCase();
  const p = phrase.replace(/\s+/g, " ").trim().toLowerCase();
  if (!p) return false;
  if (h.includes(p)) return true;
  const compact = p.replace(/\s+/g, "");
  if (compact.length >= 2 && h.replace(/\s+/g, "").includes(compact)) return true;
  return false;
}

function extraTokenMatches(haystack: string, token: string): boolean {
  const t = token.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/^시즌\s*\d+$/i.test(t) || /^season\s*\d+$/i.test(t)) {
    const n = t.match(/\d+/)?.[0];
    if (!n) return true;
    return (
      new RegExp(`시즌\\s*${n}(?!\\d)`, "i").test(haystack) ||
      new RegExp(`season\\s*${n}(?!\\d)`, "i").test(haystack)
    );
  }
  return pathContainsPhrase(haystack, t);
}

/** 질문의 프로젝트·추가어·성격이 경로/제목에 있는지. 프로젝트명이 있으면 필수. */
export function haystackMatchesAsked(haystack: string, asked: AskedWhat): boolean {
  if (!haystack.trim()) return false;
  if (isGarbage3dPath(haystack)) return false;
  if (asked.projectPhrases.length > 0) {
    const hit = asked.projectPhrases.some((p) => pathContainsPhrase(haystack, p));
    if (!hit) return false;
  }
  const requireExtra =
    asked.nature !== "any" || asked.material === "image";
  if (requireExtra) {
    for (const tok of asked.extraTokens) {
      if (!extraTokenMatches(haystack, tok)) return false;
    }
  }
  if (asked.nature !== "any" && !natureMatchesPath(haystack, asked.nature)) {
    return false;
  }
  return true;
}

function cardHaystack(card: LunaCard): string {
  return [
    card.title,
    card.description,
    card.raw_path,
    card.project,
    card.image_description
  ]
    .filter(Boolean)
    .join("\n");
}

function notionHaystack(src: NotionSource): string {
  return [
    src.title,
    src.excerpt,
    src.nas_path,
    src.hierarchy,
    ...(src.paths ?? []),
    ...(src.entities ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

function wikiHaystack(hit: WikiSourceRef): string {
  return [hit.title, hit.slug, hit.excerpt, hit.path, hit.section_title]
    .filter(Boolean)
    .join("\n");
}

export function filterCardsByAsked(cards: LunaCard[], asked: AskedWhat): LunaCard[] {
  let next = cards.filter((c) => !isGarbage3dPath(cardHaystack(c)));
  if (asked.projectPhrases.length > 0) {
    next = next.filter((c) => haystackMatchesAsked(cardHaystack(c), asked));
  } else {
    next = next.filter((c) => !isGarbage3dPath(c.raw_path || c.title || ""));
  }
  if (asked.material === "image") {
    next = next.filter((c) => c.type === "image");
  } else if (asked.material === "doc") {
    next = next.filter((c) => c.type !== "image");
  }
  return next;
}

export function filterNotionByAsked(
  sources: NotionSource[],
  asked: AskedWhat
): NotionSource[] {
  if (asked.material === "image") return [];
  if (asked.projectPhrases.length === 0) return sources;
  return sources.filter((s) => haystackMatchesAsked(notionHaystack(s), asked));
}

export function filterWikiByAsked(
  sources: WikiSourceRef[],
  asked: AskedWhat
): WikiSourceRef[] {
  if (asked.material === "image") return [];
  if (asked.projectPhrases.length === 0) return sources;
  return sources.filter((s) => haystackMatchesAsked(wikiHaystack(s), asked));
}

export function filterNasByAsked<T extends { path: string }>(
  rows: T[],
  asked: AskedWhat
): T[] {
  const next = rows.filter((r) => !isGarbage3dPath(r.path));
  if (asked.material === "image") return [];
  if (asked.projectPhrases.length === 0) return next;
  return next.filter((r) => haystackMatchesAsked(r.path, asked));
}

export function filterRetrievedByAsked(
  bundle: RetrievedBundle,
  asked: AskedWhat
): RetrievedBundle & { counts: FilterCounts } {
  const retrieved =
    bundle.cards.length +
    bundle.notion.length +
    bundle.wiki.length +
    bundle.nas.length;
  const cards = filterCardsByAsked(bundle.cards, asked);
  const notion = filterNotionByAsked(bundle.notion, asked);
  const wiki = filterWikiByAsked(bundle.wiki, asked);
  const nas = asked.material === "image" ? [] : filterNasByAsked(bundle.nas, asked);
  const matching = cards.length + notion.length + wiki.length + nas.length;
  return {
    cards,
    notion,
    wiki,
    nas,
    counts: { retrieved, matching, shown: matching }
  };
}

function titleUsed(answer: string, title: string): boolean {
  const t = title.trim();
  if (t.length < 4) return false;
  return answer.includes(t) || answer.includes(`「${t}」`);
}

export function cardUsedInAnswer(card: LunaCard, answer: string): boolean {
  if (card.type === "image") return true;
  if (titleUsed(answer, card.title)) return true;
  const raw = (card.raw_path || "").trim();
  if (!raw) return false;
  const leaf = raw.split(/[/\\]/).pop() || "";
  if (leaf.length >= 4 && answer.includes(leaf)) return true;
  return false;
}

export function keepSourcesUsedInAnswer(opts: {
  cards: LunaCard[];
  notion: NotionSource[];
  wiki: WikiSourceRef[];
  answer: string;
  notFound: boolean;
}): { cards: LunaCard[]; notion: NotionSource[]; wiki: WikiSourceRef[] } {
  if (opts.notFound) {
    return { cards: [], notion: [], wiki: [] };
  }
  const answer = opts.answer.trim();
  if (!answer) {
    return { cards: opts.cards, notion: opts.notion, wiki: opts.wiki };
  }
  const images = opts.cards.filter((c) => c.type === "image");
  const otherCards = opts.cards.filter((c) => c.type !== "image");
  const cards = [
    ...images,
    ...otherCards.filter((c) => cardUsedInAnswer(c, answer))
  ];
  const notion = opts.notion.filter(
    (s) => titleUsed(answer, s.title) || Boolean(s.url && answer.includes(s.url))
  );
  const wiki = opts.wiki.filter(
    (h) => titleUsed(answer, h.title) || titleUsed(answer, h.section_title)
  );
  return { cards, notion, wiki };
}

export function isNotFoundAnswerText(answer: string): boolean {
  return /찾지 못했|못 찾았|안 잡혀요|기억해둘게요/.test(answer) &&
    !hasPositiveRetrievedEvidence(answer);
}

export function formatNotFoundAnswer(
  asked: AskedWhat,
  seenFolderLabels: string[]
): string {
  const name = asked.displayProject || asked.projectPhrases[0] || "그 프로젝트";
  const want =
    [natureLabelKo(asked.nature), asked.material === "image" ? "이미지" : ""]
      .filter(Boolean)
      .join(" ") || asked.summary || "요청하신 자료";
  if (seenFolderLabels.length > 0) {
    return (
      `${name} 폴더를 봤는데 ${seenFolderLabels.join(" · ")} 만 있고\n` +
      `${want}라고 할 만한 게 안 잡혀요.\n` +
      `어디 있는지 알려주시면 기억해둘게요.`
    );
  }
  return (
    `${name}에서 ${want}를 찾지 못했습니다.\n` +
    `어디 있는지 알려주시면 기억해둘게요.`
  );
}

export function scoreEvidenceMatch(opts: {
  retrieved: number;
  matching: number;
  askedClear: boolean;
  notFound: boolean;
}): {
  intent_score: number;
  confidence_score: number;
  self_note: string;
} {
  const intent = opts.askedClear ? 9 : 6;
  if (opts.notFound) {
    return {
      intent_score: intent,
      confidence_score: 2,
      self_note: "질문에 맞는 자료를 찾지 못함"
    };
  }
  if (opts.retrieved === 0) {
    return {
      intent_score: opts.askedClear ? 9 : 7,
      confidence_score: opts.askedClear ? 2 : 7,
      self_note: opts.askedClear
        ? "질문에 맞는 자료를 찾지 못함"
        : "자료 검색 없이 답함"
    };
  }
  if (opts.matching === 0) {
    return {
      intent_score: intent,
      confidence_score: 2,
      self_note: "찾은 자료가 질문에 맞지 않음"
    };
  }
  const denom = Math.max(opts.retrieved, opts.matching);
  const ratio = opts.matching / denom;
  const confidence = Math.max(1, Math.min(10, Math.round(ratio * 10)));
  return {
    intent_score: intent,
    confidence_score: confidence,
    self_note: `찾은 ${denom}건 중 질문에 맞는 자료 ${opts.matching}건`
  };
}

