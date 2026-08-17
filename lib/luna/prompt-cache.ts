import type Anthropic from "@anthropic-ai/sdk";
import type { LunaTier } from "@/lib/luna/brain-models";
import { WORKSERVER_STRUCTURE_FALLBACK } from "@/lib/luna/prompt-fallbacks";

/** Anthropic 캐시 브레이크포인트 최대 4개. 우리는 고정 3 + 변동 0. */
export const MAX_CACHE_BREAKPOINTS = 4;

export const WORKSERVER_STRUCTURE = WORKSERVER_STRUCTURE_FALLBACK;

export type CacheableBlock = {
  text: string;
  cache: boolean;
};

export type CachedSystemPayload = {
  /** Anthropic system. 캐시 미적용이면 문자열. */
  anthropic: string | Anthropic.TextBlockParam[];
  /** OpenAI·Gemini 용. 고정 부분이 앞에 온다. */
  text: string;
  applied: boolean;
  cacheChars: number;
};

export function estimateTokens(text: string): number {
  const n = [...text].length;
  if (n === 0) return 0;
  return Math.max(1, Math.ceil(n / 2));
}

export function cacheMinTokens(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("haiku")) return 2048;
  return 1024;
}

export function defaultUseCaching(tier: LunaTier): boolean {
  return tier === "A" || tier === "C";
}

export function shouldApplyPromptCache(opts: {
  tier: LunaTier;
  useCaching: boolean;
  modelId: string;
  cacheableText: string;
}): boolean {
  if (opts.tier === "S") return false;
  if (!opts.useCaching) return false;
  const min = cacheMinTokens(opts.modelId);
  if (opts.tier === "B" && estimateTokens(opts.cacheableText) < min) {
    return false;
  }
  return estimateTokens(opts.cacheableText) >= min;
}

function joinBlocks(blocks: CacheableBlock[]): string {
  return blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 짧은 캐시 블록은 앞 블록과 합친다. cache_control 은 각 캐시 구간의 마지막에만.
 */
export function buildCachedSystem(
  blocks: CacheableBlock[],
  opts: { enabled: boolean; modelId: string }
): CachedSystemPayload {
  const cleaned = blocks
    .map((b) => ({ text: b.text.trim(), cache: b.cache && Boolean(b.text.trim()) }))
    .filter((b) => b.text);
  const text = joinBlocks(cleaned);
  const cacheableText = joinBlocks(cleaned.filter((b) => b.cache));
  const min = cacheMinTokens(opts.modelId);
  const enabled =
    opts.enabled && estimateTokens(cacheableText) >= min;

  if (!enabled) {
    return { anthropic: text, text, applied: false, cacheChars: cacheableText.length };
  }

  const packedCache: string[] = [];
  let acc = "";
  for (const block of cleaned.filter((b) => b.cache)) {
    acc = acc ? `${acc}\n\n${block.text}` : block.text;
    if (estimateTokens(acc) >= min) {
      packedCache.push(acc);
      acc = "";
    }
  }
  if (acc) {
    if (packedCache.length > 0) {
      packedCache[packedCache.length - 1] += `\n\n${acc}`;
    } else {
      packedCache.push(acc);
    }
  }

  const volatileText = joinBlocks(cleaned.filter((b) => !b.cache));
  let cacheBreakpoints = 0;
  const anthropic: Anthropic.TextBlockParam[] = packedCache.map((blockText) => {
    const param: Anthropic.TextBlockParam = { type: "text", text: blockText };
    if (cacheBreakpoints < MAX_CACHE_BREAKPOINTS) {
      param.cache_control = { type: "ephemeral" };
      cacheBreakpoints += 1;
    }
    return param;
  });
  if (volatileText) {
    anthropic.push({ type: "text", text: volatileText });
  }

  return {
    anthropic,
    text,
    applied: cacheBreakpoints > 0,
    cacheChars: cacheableText.length
  };
}

export function formatLearningsBlock(
  learnings: Array<{ content: string; category: string }>
): string {
  if (learnings.length === 0) return "";
  const lines = learnings.map((l) => `- ${l.content} (${l.category})`).join("\n");
  return `[아폴론에 대해 알고 있는 것]\n${lines}`;
}

export function formatGlossaryBlock(
  terms: Array<{ term_ko?: string | null; definition?: string | null }>
): string {
  const lines: string[] = [];
  for (const t of terms) {
    const name = (t.term_ko ?? "").trim();
    if (!name) continue;
    const def = (t.definition ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    lines.push(def ? `- ${name}: ${def}` : `- ${name}`);
    if (lines.length >= 60) break;
  }
  if (lines.length === 0) return "";
  return `[용어사전]\n${lines.join("\n")}`;
}

export function flattenSystem(
  system: string | Anthropic.TextBlockParam[] | undefined
): string {
  if (!system) return "";
  if (typeof system === "string") return system.trim();
  return system
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function wrapSystemForCache(
  system: string | undefined,
  opts: { enabled: boolean; modelId: string }
): CachedSystemPayload {
  const text = system?.trim() ?? "";
  if (!text) {
    return { anthropic: "", text: "", applied: false, cacheChars: 0 };
  }
  return buildCachedSystem([{ text, cache: true }], opts);
}
