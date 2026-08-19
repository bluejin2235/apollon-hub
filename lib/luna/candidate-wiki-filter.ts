import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmbedding, learningEmbedText } from "@/lib/luna/embedding";
import {
  matchLearningEmbeddings,
  matchWikiEmbeddings,
  type WikiEmbeddingHit
} from "@/lib/luna/embedding-search";
import { lunaNotify } from "@/lib/luna/notify";
import { isGlossaryCandidate } from "@/lib/luna/candidate-format";
import { parseSections } from "@/lib/wiki/sections";

export const WIKI_KNOWLEDGE_OVERLAP = 0.8;
export const CANDIDATE_MIN_CHARS = 15;
export const FILTER_STATS_KEY = "candidate_filter_stats";
const OVERLAP_CHECK_VERSION = 3;

export type CandidateFilterReason =
  | "wiki_injected"
  | "wiki_similar"
  | "learning_similar"
  | "too_short";

export type WikiCorrectionMeta = {
  title: string;
  section: string;
  slug: string;
  similarity: number;
  library_id: string;
  section_id: string;
};

export type OverlapHit = {
  wiki: WikiEmbeddingHit | null;
  wikiLoose: WikiEmbeddingHit | null;
  learningId: string | null;
  learningSimilarity: number;
};

const CORRECTION_RE =
  /아니라|그게 아니고|그게 아니라|틀렸|잘못된|아니야|아니에요/;
const HUMAN_TEACH_RE =
  /라고도|우리는|알려줄게|기억해|이게 맞아|그게 맞아|그게 아니라/;

function asMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function kstDateKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function assistantUsedKnownSources(meta: unknown): boolean {
  const m = asMeta(meta);
  const wiki = m.wiki_sources;
  const privateWiki = m.private_wiki_refs;
  const ids = m.injected_knowledge_ids;
  if (Array.isArray(wiki) && wiki.length > 0) return true;
  if (Array.isArray(privateWiki) && privateWiki.length > 0) return true;
  if (Array.isArray(ids) && ids.length > 0) return true;
  return false;
}

export function looksLikeCorrection(text: string): boolean {
  return CORRECTION_RE.test(text);
}

export function looksLikeHumanTeach(text: string): boolean {
  return HUMAN_TEACH_RE.test(text);
}

export function evidenceCitesWiki(evidence?: string | null): boolean {
  return /위키\s*「/.test(evidence ?? "");
}

export function isCorrectionCandidate(
  meta: unknown,
  ...texts: Array<string | null | undefined>
): boolean {
  const m = asMeta(meta);
  if (m.from_correction === true) return true;
  return texts.some((t) => typeof t === "string" && looksLikeCorrection(t));
}

export function newSliceHasHumanTeachOrCorrection(
  messages: Array<{ role: string; content: string }>
): boolean {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  return looksLikeCorrection(userText) || looksLikeHumanTeach(userText);
}

export function newSliceUsedKnownSources(
  messages: Array<{ role: string; metadata?: unknown }>
): boolean {
  return messages.some(
    (m) => m.role === "assistant" && assistantUsedKnownSources(m.metadata)
  );
}

export async function conversationUsedKnownSources(
  admin: SupabaseClient,
  conversationId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("luna_messages")
    .select("role, metadata")
    .eq("conversation_id", conversationId);
  if (error) {
    console.error("[luna/candidate-filter] messages", error);
    return false;
  }
  return (data ?? []).some(
    (m) => m.role === "assistant" && assistantUsedKnownSources(m.metadata)
  );
}

export async function recordCandidateFilter(
  admin: SupabaseClient,
  reason: CandidateFilterReason
): Promise<void> {
  const day = kstDateKey();
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", FILTER_STATS_KEY)
    .maybeSingle();
  const prev =
    data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? (data.value as Record<string, unknown>)
      : {};
  const sameDay = prev.day === day;
  const next = {
    day,
    wiki_injected: (sameDay ? Number(prev.wiki_injected) || 0 : 0) +
      (reason === "wiki_injected" ? 1 : 0),
    wiki_similar: (sameDay ? Number(prev.wiki_similar) || 0 : 0) +
      (reason === "wiki_similar" ? 1 : 0),
    learning_similar: (sameDay ? Number(prev.learning_similar) || 0 : 0) +
      (reason === "learning_similar" ? 1 : 0),
    too_short: (sameDay ? Number(prev.too_short) || 0 : 0) +
      (reason === "too_short" ? 1 : 0)
  };
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: FILTER_STATS_KEY,
      value: next,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) {
    console.error("[luna/candidate-filter] stats", error);
  }
  console.log(`[luna/candidate-filter] ${reason} day=${day}`, next);
}

export async function candidateFilterMorningLine(
  admin: SupabaseClient
): Promise<string | null> {
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", FILTER_STATS_KEY)
    .maybeSingle();
  const value =
    data?.value && typeof data.value === "object" && !Array.isArray(data.value)
      ? (data.value as Record<string, unknown>)
      : null;
  if (!value || value.day !== kstDateKey()) return null;
  const wikiInjected = Number(value.wiki_injected) || 0;
  const wikiSimilar = Number(value.wiki_similar) || 0;
  const learningSimilar = Number(value.learning_similar) || 0;
  const tooShort = Number(value.too_short) || 0;
  const n = wikiInjected + wikiSimilar + learningSimilar + tooShort;
  if (n <= 0) return null;
  return `위키·기존지식과 겹쳐 후보 ${n}건 걸러짐 (위키주입 ${wikiInjected} · 유사 ${wikiSimilar + learningSimilar} · 짧은문장 ${tooShort})`;
}

async function attachCorrectionWiki(
  admin: SupabaseClient,
  meta: Record<string, unknown>,
  hit: WikiEmbeddingHit
): Promise<void> {
  const wikiMeta = await lookupWikiHit(admin, hit);
  if (!wikiMeta) return;
  meta.from_correction = true;
  meta.wiki_correction = wikiMeta;
  await lunaNotify(
    admin,
    "conflict",
    "위키와 다른 정정이 올라왔어요",
    `위키 「${wikiMeta.title}」의 「${wikiMeta.section}」과 다릅니다. 위키 문서를 고쳐 주세요.`,
    {
      level: "warn",
      link: wikiMeta.slug ? `/wiki/${wikiMeta.slug}` : undefined
    }
  );
}

export async function lookupWikiHit(
  admin: SupabaseClient,
  hit: WikiEmbeddingHit
): Promise<WikiCorrectionMeta | null> {
  const { data, error } = await admin
    .from("luna_library")
    .select("id, title, slug, sections")
    .eq("id", hit.library_id)
    .maybeSingle();
  if (error) {
    console.error("[luna/candidate-filter] wiki lookup", error);
    return null;
  }
  if (!data) return null;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  const sections = parseSections(data.sections);
  const section =
    sections.find((s) => s.id === hit.section_id)?.title.trim() || "본문";
  return {
    title: title || "위키 문서",
    section,
    slug,
    similarity: hit.similarity,
    library_id: hit.library_id,
    section_id: hit.section_id
  };
}

export async function findKnowledgeOverlaps(
  admin: SupabaseClient,
  content: string,
  excludeLearningId?: string | null
): Promise<OverlapHit> {
  const empty: OverlapHit = {
    wiki: null,
    wikiLoose: null,
    learningId: null,
    learningSimilarity: 0
  };
  const vector = await createEmbedding(learningEmbedText(content));
  if (!vector) return empty;
  const [wikiHits, learningHits] = await Promise.all([
    matchWikiEmbeddings(admin, vector, {
      threshold: 0.35,
      limit: 3
    }),
    matchLearningEmbeddings(admin, vector, {
      threshold: WIKI_KNOWLEDGE_OVERLAP,
      limit: 8
    })
  ]);
  const wiki = wikiHits[0] ?? null;
  const learning = learningHits.find(
    (h) => h.id && h.id !== excludeLearningId
  );
  return {
    wiki: wiki && wiki.similarity >= WIKI_KNOWLEDGE_OVERLAP ? wiki : null,
    wikiLoose: wiki,
    learningId:
      learning && learning.similarity >= WIKI_KNOWLEDGE_OVERLAP
        ? learning.id
        : null,
    learningSimilarity: learning?.similarity ?? 0
  };
}

export type GateCandidateInput = {
  content: string;
  source: string;
  category?: string | null;
  meta?: Record<string, unknown> | null;
  evidence?: string | null;
  raw_input?: string | null;
  excludeLearningId?: string | null;
  sourceConversationId?: string | null;
};

export type GateCandidateResult =
  | { ok: true; meta: Record<string, unknown> }
  | { ok: false; reason: CandidateFilterReason };

export async function gateNewCandidate(
  admin: SupabaseClient,
  input: GateCandidateInput
): Promise<GateCandidateResult> {
  const content = input.content.trim();
  const meta = { ...(input.meta ?? {}) };
  const correction = isCorrectionCandidate(
    meta,
    content,
    input.evidence,
    input.raw_input
  );
  const glossary = isGlossaryCandidate(meta, input.category);

  if (input.source !== "question" && !correction) {
    if (content.length < CANDIDATE_MIN_CHARS) {
      await recordCandidateFilter(admin, "too_short");
      return { ok: false, reason: "too_short" };
    }
    if (evidenceCitesWiki(input.evidence)) {
      await recordCandidateFilter(admin, "wiki_injected");
      return { ok: false, reason: "wiki_injected" };
    }
    const blob = `${content}\n${input.evidence ?? ""}\n${input.raw_input ?? ""}`;
    if (
      input.source === "chat" &&
      input.sourceConversationId &&
      !looksLikeHumanTeach(blob) &&
      (await conversationUsedKnownSources(admin, input.sourceConversationId))
    ) {
      await recordCandidateFilter(admin, "wiki_injected");
      return { ok: false, reason: "wiki_injected" };
    }
  }

  if (input.source === "question" || glossary) {
    return { ok: true, meta };
  }

  const overlap = await findKnowledgeOverlaps(
    admin,
    content,
    input.excludeLearningId
  );
  if (overlap.wiki && overlap.wiki.similarity >= WIKI_KNOWLEDGE_OVERLAP) {
    if (correction) {
      await attachCorrectionWiki(admin, meta, overlap.wiki);
      return { ok: true, meta };
    }
    await recordCandidateFilter(admin, "wiki_similar");
    return { ok: false, reason: "wiki_similar" };
  }

  if (
    overlap.learningId &&
    overlap.learningSimilarity >= WIKI_KNOWLEDGE_OVERLAP &&
    !correction
  ) {
    await recordCandidateFilter(admin, "learning_similar");
    return { ok: false, reason: "learning_similar" };
  }

  if (correction) {
    meta.from_correction = true;
    if (overlap.wikiLoose) {
      await attachCorrectionWiki(admin, meta, overlap.wikiLoose);
    }
  }
  return { ok: true, meta };
}

export async function rejudgePendingCandidates(
  admin: SupabaseClient
): Promise<{ deleted: number; tagged: number; remaining: number }> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, category, source, meta, evidence, raw_input, source_conversation_id")
    .eq("status", "candidate")
    .neq("category", "identity");
  if (error) {
    console.error("[luna/candidate-filter] rejudge list", error);
    return { deleted: 0, tagged: 0, remaining: 0 };
  }

  let deleted = 0;
  let tagged = 0;
  const { attachCandidateDuplicate } = await import(
    "@/lib/luna/knowledge-duplicate"
  );

  for (const row of data ?? []) {
    const id = String(row.id);
    const content = typeof row.content === "string" ? row.content.trim() : "";
    const meta = asMeta(row.meta);
    if (Number(meta.wiki_overlap_v) === OVERLAP_CHECK_VERSION) continue;

    const gated = await gateNewCandidate(admin, {
      content,
      source: typeof row.source === "string" ? row.source : "chat",
      category: typeof row.category === "string" ? row.category : null,
      meta,
      evidence: typeof row.evidence === "string" ? row.evidence : null,
      raw_input: typeof row.raw_input === "string" ? row.raw_input : null,
      excludeLearningId: id,
      sourceConversationId:
        typeof row.source_conversation_id === "string"
          ? row.source_conversation_id
          : null
    });

    if (!gated.ok) {
      const { error: delErr } = await admin
        .from("luna_learnings")
        .delete()
        .eq("id", id);
      if (delErr) {
        console.error("[luna/candidate-filter] rejudge delete", delErr);
      } else {
        deleted += 1;
      }
      continue;
    }

    const nextMeta = {
      ...gated.meta,
      wiki_overlap_checked: true,
      wiki_overlap_v: OVERLAP_CHECK_VERSION
    };
    await admin.from("luna_learnings").update({ meta: nextMeta }).eq("id", id);

    const attached = await attachCandidateDuplicate(admin, {
      id,
      content,
      category: typeof row.category === "string" ? row.category : null,
      meta: nextMeta
    });
    if (attached.matchId) tagged += 1;
  }

  const { count } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate")
    .neq("category", "identity");

  console.log(
    `[luna/candidate-filter] rejudge deleted=${deleted} tagged=${tagged} remaining=${count ?? 0}`
  );
  return { deleted, tagged, remaining: count ?? 0 };
}
