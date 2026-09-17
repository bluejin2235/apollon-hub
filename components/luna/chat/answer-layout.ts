import type { LunaProgressStep } from "@/components/luna/LunaMessage";
import type { LunaClassificationMeta } from "@/lib/luna/chat-response";
import { hasImageSearchIntent } from "@/lib/luna/media-index-search";
import {
  inferRuleClassification,
  resolveSearchScopeKind,
  type SearchScopeKind
} from "@/lib/luna/search-scope";
import { isUiProgressKey } from "@/lib/luna/progress-display";
import type { NotionSource } from "@/lib/luna/notion";
import type { LunaCard } from "@/lib/luna/tavily";
import type { WikiSourceRef } from "@/lib/luna/wiki-match";
import { docCards, imageCards } from "@/lib/luna/luna-answer-ui";

export type AnswerMode =
  | "term"
  | "policy"
  | "project"
  | "reference"
  | "default";

export type SplitSources = {
  notion: NotionSource[];
  work: LunaCard[];
  wiki: WikiSourceRef[];
  image: LunaCard[];
};

function scopeKindToMode(kind: SearchScopeKind): AnswerMode {
  if (kind === "term") return "term";
  if (kind === "policy") return "policy";
  if (kind === "project") return "project";
  if (kind === "reference") return "reference";
  return "default";
}

/** ui_* 단계가 있으면 해당 검색 채널 힌트 */
function modeHintFromSteps(steps: LunaProgressStep[] | null | undefined): AnswerMode | null {
  if (!steps?.length) return null;
  const keys = new Set(steps.filter((s) => s.status !== "skip").map((s) => s.key));
  const ui = [...keys].filter(isUiProgressKey);
  if (ui.includes("ui_glossary") && !ui.includes("ui_notion") && !ui.includes("ui_work")) {
    return "term";
  }
  if (ui.includes("ui_wiki") && !ui.includes("ui_notion") && !ui.includes("ui_work") && !ui.includes("ui_image")) {
    return "policy";
  }
  // 사례: 이미지 채널이 있으면 (노션 동반해도) reference
  if (ui.includes("ui_image") && !ui.includes("ui_work")) {
    return "reference";
  }
  if (ui.includes("ui_work") || ui.includes("ui_notion") || ui.includes("ui_link")) {
    return "project";
  }
  return null;
}

export function resolveAnswerMode(opts: {
  classification?: LunaClassificationMeta | null;
  questionText?: string | null;
  steps?: LunaProgressStep[] | null;
}): AnswerMode {
  const question = (opts.questionText ?? "").replace(/\s+/g, " ").trim();
  const fromSteps = modeHintFromSteps(opts.steps);
  if (fromSteps) return fromSteps;

  const rule = question ? inferRuleClassification(question) : null;
  if (rule) return scopeKindToMode(rule.kind);

  const types = opts.classification?.types ?? [];
  const labels = opts.classification?.labels ?? [];
  const labelText = labels.join(" ");
  if (/용어|정의|뜻|glossary/i.test(labelText)) return "term";
  if (/규정|제도|policy/i.test(labelText)) return "policy";
  if (/프로젝트|현황|진행/i.test(labelText)) return "project";
  if (/레퍼|사례|reference/i.test(labelText)) return "reference";

  if (types.length > 0 || question) {
    const kind = resolveSearchScopeKind({
      types,
      question,
      classifyConfidence: opts.classification?.confidence
    });
    return scopeKindToMode(kind);
  }

  return "default";
}

export function shouldShowImageChrome(
  mode: AnswerMode,
  questionText?: string | null
): boolean {
  if (mode === "term" || mode === "policy" || mode === "project") return false;
  if (mode === "reference") return true;
  return Boolean(questionText && hasImageSearchIntent(questionText));
}

export function splitSources(opts: {
  notionSources?: NotionSource[] | null;
  wikiSources?: WikiSourceRef[] | null;
  cards?: LunaCard[] | null;
}): SplitSources {
  const baseNotion =
    opts.notionSources?.filter((s) => s.title && (s.url || s.id)) ?? [];
  const wiki = opts.wikiSources ?? [];
  const cards = opts.cards ?? [];
  const work = docCards(cards).filter((c) => c.type === "nas");
  const notionCards = docCards(cards).filter((c) => c.type === "notion");
  const image = imageCards(cards);
  const fromCards: NotionSource[] = notionCards.map((c) => ({
    id: c.url ?? c.title,
    title: c.title,
    url: c.url ?? "",
    section: c.description ?? undefined
  }));
  const seen = new Set<string>();
  const notion: NotionSource[] = [];
  for (const s of [...baseNotion, ...fromCards]) {
    const k = s.url || s.id || s.title;
    if (seen.has(k)) continue;
    seen.add(k);
    notion.push(s);
  }
  return { notion, work, wiki, image };
}

export function isAnswerComplete(opts: {
  isThinking?: boolean;
  content: string;
}): boolean {
  if (opts.isThinking) return false;
  return true;
}
