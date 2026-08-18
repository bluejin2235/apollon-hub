import type { SupabaseClient } from "@supabase/supabase-js";
import { isGlossaryCandidate } from "@/lib/luna/candidate-format";
import { lunaLlmComplete } from "@/lib/luna/llm/client";
import { getPrompt } from "@/lib/luna/prompts";

export type DuplicateKind =
  | "identical"
  | "rewrite"
  | "update"
  | "keep_both"
  | "conflict";

export type DuplicateProposal = {
  kind: DuplicateKind;
  sentence: string;
  reason: string;
};

export type ActiveKnowledge = {
  id: string;
  content: string;
  created_at: string | null;
  status?: string;
  source?: string | null;
  merged_from?: unknown;
};

export type DuplicateMatch = ActiveKnowledge & {
  score: number;
};

export type DuplicateDecision =
  | "accept_proposal"
  | "keep_both"
  | "replace_with_new"
  | "discard_new"
  | "rewrite"
  | "accept_existing"
  | "accept_new";

const SIMILAR_THRESHOLD = 0.38;

const TOPIC_STOP = new Set([
  "아폴론",
  "apollon",
  "apollo",
  "한다",
  "있다",
  "없다",
  "위한",
  "통해",
  "대한",
  "그리고",
  "또는",
  "하는",
  "되어",
  "된다",
  "이다",
  "있는",
  "없는"
]);

const PROPOSE_FALLBACK = `두 지식을 비교해 한 가지로 판정한다.

kind 만 다음 중 하나:
- identical: 뜻이 같은 문장 (띄어쓰기·조사만 다름)
- rewrite: 같은 대상의 다른 면. 두 내용의 사실을 빠짐없이 자연스러운 한국어 한 문장으로 다시 쓴다. 이어 붙이지 말 것.
- update: 새 것이 기존 사실을 모두 담으면서 더 자세할 때만. 기존 사실이 빠지면 rewrite.
- keep_both: 서로 다른 얘기. sentence 는 새 것 재진술.
- conflict: 내용이 반대. sentence 는 비우고 reason 에 무엇이 충돌인지.

규칙
- sentence 는 한 문장. 두 원문을 세미콜론·줄바꿈으로 연결하지 않는다.
- 원문을 글자 그대로 이어 붙이지 않는다.
- 한쪽에만 있는 고유명사·숫자·절차를 버리지 않는다.
- JSON만.

{"kind":"rewrite","sentence":"…","reason":"…"}`;

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

export function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0
  );
}

export function normalizeKnowledgeText(text: string): string {
  return text
    .replace(/["""''`]/g, "")
    .replace(/[.,!?;:~…·—–\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isIdenticalKnowledge(a: string, b: string): boolean {
  const na = normalizeKnowledgeText(a);
  const nb = normalizeKnowledgeText(b);
  return na.length > 0 && na === nb;
}

function tokens(text: string): string[] {
  const n = normalizeKnowledgeText(text);
  const parts = n
    .split(/[^0-9a-z가-힣]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return parts;
}

function bigrams(text: string): string[] {
  const n = normalizeKnowledgeText(text).replace(/ /g, "");
  if (n.length < 2) return n ? [n] : [];
  const out: string[] = [];
  for (let i = 0; i < n.length - 1; i += 1) {
    out.push(n.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function knowledgeSimilarity(a: string, b: string): number {
  if (isIdenticalKnowledge(a, b)) return 1;
  const na = normalizeKnowledgeText(a);
  const nb = normalizeKnowledgeText(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.max(0.72, 0.55 + ratio * 0.35);
  }
  const tok = jaccard(tokens(a), tokens(b));
  const bi = jaccard(bigrams(a), bigrams(b));
  return tok * 0.55 + bi * 0.45;
}

export function isSameTopic(a: string, b: string): boolean {
  const ta = tokens(a).filter((t) => t.length >= 3 && !TOPIC_STOP.has(t));
  const tb = new Set(tokens(b).filter((t) => t.length >= 3 && !TOPIC_STOP.has(t)));
  const seen = new Set<string>();
  let hit = 0;
  for (const t of ta) {
    if (!tb.has(t) || seen.has(t)) continue;
    seen.add(t);
    hit += 1;
    if (hit >= 2) return true;
  }
  return false;
}

export function findDuplicateMatches(
  content: string,
  actives: ActiveKnowledge[],
  excludeId?: string | null
): DuplicateMatch[] {
  const scored: DuplicateMatch[] = [];
  for (const row of actives) {
    if (excludeId && row.id === excludeId) continue;
    if (!isSameTopic(content, row.content)) continue;
    const score = knowledgeSimilarity(content, row.content);
    if (score < SIMILAR_THRESHOLD) continue;
    scored.push({ ...row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function pickOldestActive<T extends { created_at: string | null }>(
  rows: T[]
): T | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const tb = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    return ta - tb;
  })[0]!;
}

function tokenCoverage(longer: string, source: string): number {
  const src = tokens(source).filter((t) => t.length >= 3);
  if (src.length === 0) return 1;
  const hay = normalizeKnowledgeText(longer);
  const hit = src.filter((t) => hay.includes(t)).length;
  return hit / src.length;
}

export function looksLikeConcat(merged: string, a: string, b: string): boolean {
  const n = merged.replace(/\s+/g, " ").trim();
  const na = a.replace(/\s+/g, " ").trim();
  const nb = b.replace(/\s+/g, " ").trim();
  if (!n || n.length < 8) return true;
  if (na && nb && n.includes(na) && n.includes(nb)) return true;
  if (/[;/|]\s*/.test(n) && n.includes(na.slice(0, 12)) && n.includes(nb.slice(0, 12))) {
    return true;
  }
  return false;
}

function looksContradictory(a: string, b: string): boolean {
  const pairs: [RegExp, RegExp][] = [
    [/하지 않는다|않으면 안 된다|불가하다/, /해야 한다|가능하다/],
    [/금지된다/, /허용된다|해야 한다/]
  ];
  for (const [neg, pos] of pairs) {
    if (
      (neg.test(a) && pos.test(b) && !neg.test(b)) ||
      (neg.test(b) && pos.test(a) && !neg.test(a))
    ) {
      return true;
    }
  }
  return false;
}

export function heuristicProposal(
  existing: string,
  incoming: string,
  mergeDraft?: string | null
): DuplicateProposal {
  if (isIdenticalKnowledge(existing, incoming)) {
    return {
      kind: "identical",
      sentence: existing.trim(),
      reason: "같은 문장이라 후보만 지웁니다."
    };
  }
  if (looksContradictory(existing, incoming)) {
    return {
      kind: "conflict",
      sentence: "",
      reason: "두 내용이 서로 다르게 말하고 있어요. 어느 쪽이 맞는지 골라 주세요."
    };
  }
  const sim = knowledgeSimilarity(existing, incoming);
  const oldN = normalizeKnowledgeText(existing);
  const newN = normalizeKnowledgeText(incoming);
  if (newN.length > oldN.length * 1.15 && (newN.includes(oldN) || sim >= 0.45)) {
    return {
      kind: "update",
      sentence: incoming.trim(),
      reason: "새로 들은 쪽이 더 자세해서, 오래된 기억을 이 내용으로 바꿉니다."
    };
  }
  if (oldN.length > newN.length * 1.15 && (oldN.includes(newN) || sim >= 0.45)) {
    return {
      kind: "rewrite",
      sentence: existing.trim(),
      reason: "이미 아는 쪽에 내용이 더 담겨 있어요. 후보는 지우고 기존을 남깁니다."
    };
  }
  if (sim < 0.22) {
    return {
      kind: "keep_both",
      sentence: incoming.trim(),
      reason: "서로 다른 얘기로 보여서 둘 다 남기려고 합니다."
    };
  }
  const draft = mergeDraft?.trim() || "";
  const sentence =
    draft && !looksLikeConcat(draft, existing, incoming) ? draft : incoming.trim();
  return {
    kind: "rewrite",
    sentence,
    reason:
      "같은 대상을 두고 서로 다른 면을 말하고 있어요. 한 문장으로 다시 쓰고, 오래된 쪽에 기록을 남긴 뒤 새 후보는 지웁니다."
  };
}

export async function proposeDuplicate(
  admin: SupabaseClient,
  opts: {
    existing: string;
    incoming: string;
    mergeDraft?: string | null;
  }
): Promise<DuplicateProposal> {
  const fallback = heuristicProposal(
    opts.existing,
    opts.incoming,
    opts.mergeDraft
  );
  if (fallback.kind === "identical") return fallback;

  const system =
    (await getPrompt(admin, "learn.dialogue")).trim() || PROPOSE_FALLBACK;
  const user = [
    "기존 지식:",
    opts.existing,
    "",
    "새로 들은 것:",
    opts.incoming,
    opts.mergeDraft ? `\n참고용 병합 초안(이어 붙인 것이면 쓰지 말 것):\n${opts.mergeDraft}` : "",
    "",
    PROPOSE_FALLBACK
  ].join("\n");

  try {
    const res = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "candidate_dialogue",
      system,
      user,
      maxTokens: 700
    });
    const parsed = parseJsonObject(res.text);
    const kindRaw = typeof parsed?.kind === "string" ? parsed.kind : "";
    const kind: DuplicateKind | null =
      kindRaw === "identical" ||
      kindRaw === "rewrite" ||
      kindRaw === "update" ||
      kindRaw === "keep_both" ||
      kindRaw === "conflict"
        ? kindRaw
        : null;
    if (!kind) return fallback;
    const sentence =
      typeof parsed?.sentence === "string" ? parsed.sentence.trim() : "";
    const reason =
      typeof parsed?.reason === "string" ? parsed.reason.trim() : fallback.reason;
    if (kind === "identical") {
      return {
        kind,
        sentence: opts.existing.trim(),
        reason: reason || fallback.reason
      };
    }
    if (kind === "conflict") {
      return { kind, sentence: "", reason: reason || fallback.reason };
    }
    if (kind === "rewrite" && sentence && looksLikeConcat(sentence, opts.existing, opts.incoming)) {
      return fallback.kind === "rewrite" && !looksLikeConcat(fallback.sentence, opts.existing, opts.incoming)
        ? fallback
        : { ...fallback, kind: "rewrite", reason };
    }
    if ((kind === "rewrite" || kind === "update" || kind === "keep_both") && !sentence) {
      return fallback;
    }
    if (kind === "update" || kind === "rewrite") {
      const coversOld = tokenCoverage(sentence, opts.existing) >= 0.45;
      if (kind === "update" && !coversOld) {
        return {
          kind: "rewrite",
          sentence: fallback.sentence || sentence,
          reason:
            "같은 대상을 두고 서로 다른 면을 말하고 있어요. 한 문장으로 다시 쓰고, 오래된 쪽에 기록을 남긴 뒤 새 후보는 지웁니다."
        };
      }
      const coversNew = tokenCoverage(sentence, opts.incoming) >= 0.35;
      if (
        kind === "rewrite" &&
        (!coversOld || !coversNew) &&
        fallback.sentence &&
        tokenCoverage(fallback.sentence, opts.existing) +
          tokenCoverage(fallback.sentence, opts.incoming) >
          tokenCoverage(sentence, opts.existing) + tokenCoverage(sentence, opts.incoming)
      ) {
        return {
          kind: "rewrite",
          sentence: fallback.sentence,
          reason: reason || fallback.reason
        };
      }
    }
    return { kind, sentence, reason: reason || fallback.reason };
  } catch (err) {
    console.error("[luna/knowledge-duplicate] propose", err);
    return fallback;
  }
}

export async function proposeNewKnowledge(
  admin: SupabaseClient,
  content: string
): Promise<{ sentence: string; reason: string }> {
  const system =
    (await getPrompt(admin, "learn.dialogue")).trim() ||
    "사람이 알려준 지식을 한두 문장으로 재진술한다. 원문 복사 금지.";
  try {
    const res = await lunaLlmComplete(admin, {
      tier: "C",
      feature: "candidate_dialogue",
      system,
      user: `다음 지식을 검색하기 쉬운 한국어로 재진술하세요. 원문 복사 금지. JSON만.\n{"sentence":"재진술한 문장","reason":"왜 기억할 가치가 있는지 한 줄"}\n\n원문:\n${content}`,
      maxTokens: 400
    });
    const parsed = parseJsonObject(res.text);
    const sentence =
      typeof parsed?.sentence === "string" ? parsed.sentence.trim() : "";
    const reason =
      typeof parsed?.reason === "string" ? parsed.reason.trim() : "";
    if (sentence) {
      return {
        sentence,
        reason: reason || "아폴론이 일하는 방식과 관련된 사실이라 기억해 두려고 합니다."
      };
    }
  } catch (err) {
    console.error("[luna/knowledge-duplicate] propose new", err);
  }
  return {
    sentence: content.trim(),
    reason: "아폴론이 일하는 방식과 관련된 사실이라 기억해 두려고 합니다."
  };
}

export function pickOldestKeep<T extends { id: string; created_at: string | null; status?: string }>(
  existing: T,
  incoming: T
): T {
  const existingActive = existing.status === "active";
  const incomingActive = incoming.status === "active";
  if (existingActive && !incomingActive) return existing;
  if (incomingActive && !existingActive) return incoming;
  const te = existing.created_at ? Date.parse(existing.created_at) : Number.POSITIVE_INFINITY;
  const ti = incoming.created_at ? Date.parse(incoming.created_at) : Number.POSITIVE_INFINITY;
  if (ti < te) return incoming;
  return existing;
}

export async function loadActiveKnowledge(
  admin: SupabaseClient
): Promise<ActiveKnowledge[]> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, created_at, status, source, merged_from")
    .eq("status", "active")
    .neq("category", "identity")
    .limit(800);
  if (error) {
    console.error("[luna/knowledge-duplicate] load active", error);
    return [];
  }
  return ((data ?? []) as ActiveKnowledge[]).filter(
    (r) => typeof r.content === "string" && r.content.trim().length > 0
  );
}

export async function tryMarkNotDuplicate(
  admin: SupabaseClient,
  candidateId: string
): Promise<void> {
  const error = await updateLearning(admin, candidateId, {
    review_reason: "new",
    duplicate_of: null,
    merge_target: null
  });
  if (error) {
    console.error("[luna/knowledge-duplicate] mark new", error);
  }
}

export async function trySetDuplicateOf(
  admin: SupabaseClient,
  candidateId: string,
  matchId: string
): Promise<void> {
  const error = await updateLearning(admin, candidateId, {
    duplicate_of: matchId,
    merge_target: matchId,
    review_reason: "duplicate"
  });
  if (error) {
    console.error("[luna/knowledge-duplicate] set duplicate_of", error);
  }
}

async function updateLearning(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>
): Promise<{ message: string } | null> {
  const { error } = await admin.from("luna_learnings").update(patch).eq("id", id);
  if (!error) return null;
  if (/duplicate_of/i.test(error.message) && "duplicate_of" in patch) {
    const rest = { ...patch };
    delete rest.duplicate_of;
    const { error: fallbackError } = await admin
      .from("luna_learnings")
      .update(rest)
      .eq("id", id);
    if (!fallbackError) return null;
    return fallbackError;
  }
  return error;
}

export async function attachCandidateDuplicate(
  admin: SupabaseClient,
  row: {
    id: string;
    content: string;
    category?: string | null;
    meta?: Record<string, unknown> | null;
  }
): Promise<{ identicalDropped: boolean; matchId: string | null }> {
  if (isGlossaryCandidate(row.meta, row.category)) {
    return { identicalDropped: false, matchId: null };
  }
  const actives = await loadActiveKnowledge(admin);
  const matches = findDuplicateMatches(row.content, actives, row.id);
  const identical = matches.find((m) => isIdenticalKnowledge(row.content, m.content));
  if (identical) {
    const { error } = await admin.from("luna_learnings").delete().eq("id", row.id);
    if (error) {
      console.error("[luna/knowledge-duplicate] drop identical", error);
    }
    return { identicalDropped: true, matchId: identical.id };
  }
  const primary = pickOldestActive(matches);
  if (!primary) return { identicalDropped: false, matchId: null };
  await trySetDuplicateOf(admin, row.id, primary.id);
  return { identicalDropped: false, matchId: primary.id };
}

async function nextVersionNumber(
  admin: SupabaseClient,
  learningId: string
): Promise<number> {
  const { data } = await admin
    .from("luna_learning_versions")
    .select("version")
    .eq("learning_id", learningId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const current = typeof data?.version === "number" ? data.version : 0;
  return current + 1;
}

async function editorName(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  return typeof data?.name === "string" && data.name.trim()
    ? data.name.trim()
    : null;
}

async function recordMergeVersion(
  admin: SupabaseClient,
  opts: {
    learningId: string;
    previousContent: string;
    incomingOriginal: string;
    userId: string;
    note?: string;
  }
): Promise<{ error: string | null }> {
  const version = await nextVersionNumber(admin, opts.learningId);
  const name = await editorName(admin, opts.userId);
  const note = [
    opts.note ?? "다른 지식과 합침",
    "",
    "합친 원문:",
    opts.incomingOriginal.trim()
  ].join("\n");
  const { error } = await admin.from("luna_learning_versions").insert({
    learning_id: opts.learningId,
    version,
    content: opts.previousContent,
    status: "active",
    change_note: note,
    edited_by: opts.userId,
    editor_name: name
  });
  if (error) {
    console.error("[luna/knowledge-duplicate] version", error);
    return { error: error.message };
  }
  return { error: null };
}

async function deleteLearning(
  admin: SupabaseClient,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await admin.from("luna_learnings").delete().eq("id", id);
  if (error) {
    console.error("[luna/knowledge-duplicate] delete", error);
    return { error: error.message };
  }
  return { error: null };
}

async function archiveDroppedCandidate(
  admin: SupabaseClient,
  opts: {
    id: string;
    meta: Record<string, unknown>;
    userId: string;
    nowIso: string;
  }
): Promise<{ error: string | null }> {
  const error = await updateLearning(admin, opts.id, {
    status: "archived",
    review_reason: null,
    merge_target: null,
    duplicate_of: null,
    meta: opts.meta,
    resolved_by: opts.userId,
    resolved_at: opts.nowIso
  });
  return { error: error?.message ?? null };
}

export async function dropIdenticalCandidate(
  admin: SupabaseClient,
  candidateId: string
): Promise<{ error: string | null }> {
  return deleteLearning(admin, candidateId);
}

export async function applyDuplicateDecision(
  admin: SupabaseClient,
  opts: {
    candidate: {
      id: string;
      content: string;
      created_at: string | null;
      status?: string;
      meta: Record<string, unknown>;
      merged_from?: unknown;
    };
    existing: ActiveKnowledge;
    decision: DuplicateDecision;
    sentence?: string;
    userId: string;
    /** [아니에요] 기록(meta.reject_*)을 남기려면 후보를 지우지 않고 보관한다. */
    archiveDrop?: boolean;
  }
): Promise<{ ok: true; keep_id: string } | { ok: false; error: string }> {
  const incomingOriginal = opts.candidate.content.trim();
  const existingContent = opts.existing.content.trim();
  const existingActive = (opts.existing.status ?? "active") === "active";
  // 대표는 활성만. 후보가 더 오래돼도 활성을 지우고 후보를 남기지 않는다.
  const keep = existingActive
    ? opts.existing
    : pickOldestKeep(
        { ...opts.existing, status: opts.existing.status ?? "candidate" },
        { ...opts.candidate, status: opts.candidate.status ?? "candidate" }
      );
  const dropId =
    keep.id === opts.existing.id ? opts.candidate.id : opts.existing.id;
  const nowIso = new Date().toISOString();

  if (existingActive && dropId === opts.existing.id) {
    return { ok: false, error: "활성 지식은 대표에서 제외할 수 없습니다" };
  }

  if (opts.decision === "keep_both") {
    const error = await updateLearning(admin, opts.candidate.id, {
      status: "active",
      review_reason: null,
      merge_target: null,
      duplicate_of: null,
      meta: opts.candidate.meta,
      resolved_by: opts.userId,
      resolved_at: nowIso,
      confidence: 4,
      importance: 4
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, keep_id: opts.candidate.id };
  }

  if (opts.decision === "discard_new" || opts.decision === "accept_existing") {
    const dropped =
      opts.archiveDrop && opts.decision === "discard_new"
        ? await archiveDroppedCandidate(admin, {
            id: opts.candidate.id,
            meta: opts.candidate.meta,
            userId: opts.userId,
            nowIso
          })
        : await deleteLearning(admin, opts.candidate.id);
    if (dropped.error) return { ok: false, error: dropped.error };
    return { ok: true, keep_id: opts.existing.id };
  }

  let nextContent = existingContent;
  if (opts.decision === "replace_with_new" || opts.decision === "accept_new") {
    nextContent = incomingOriginal;
  } else if (opts.decision === "rewrite") {
    nextContent = (opts.sentence || incomingOriginal).trim();
  } else {
    nextContent = (opts.sentence || incomingOriginal).trim();
  }
  if (!nextContent) {
    return { ok: false, error: "합칠 문장이 비어 있습니다" };
  }

  const prevMerged = asIdList(
    keep.id === opts.existing.id ? opts.existing.merged_from : opts.candidate.merged_from
  );
  const mergedFrom = Array.from(new Set([...prevMerged, dropId]));
  const previousContent =
    keep.id === opts.existing.id ? existingContent : incomingOriginal;
  const incomingForNote =
    keep.id === opts.existing.id ? incomingOriginal : existingContent;

  const ver = await recordMergeVersion(admin, {
    learningId: keep.id,
    previousContent,
    incomingOriginal: incomingForNote,
    userId: opts.userId,
    note:
      opts.decision === "replace_with_new" || opts.decision === "accept_new"
        ? "새 내용으로 바꿈"
        : "다른 지식과 합침"
  });
  if (ver.error) return { ok: false, error: ver.error };

  if (keep.id === opts.existing.id) {
    const keepError = await updateLearning(admin, keep.id, {
      content: nextContent,
      merged_from: mergedFrom,
      resolved_by: opts.userId,
      resolved_at: nowIso
    });
    if (keepError) return { ok: false, error: keepError.message };
    const dropped = opts.archiveDrop
      ? await archiveDroppedCandidate(admin, {
          id: opts.candidate.id,
          meta: opts.candidate.meta,
          userId: opts.userId,
          nowIso
        })
      : await deleteLearning(admin, opts.candidate.id);
    if (dropped.error) return { ok: false, error: dropped.error };
    return { ok: true, keep_id: keep.id };
  }

  // 활성이 없고 후보끼리만 겹칠 때: 오래된 후보를 남긴다.
  if (existingActive) {
    return { ok: false, error: "후보를 대표로 남길 수 없습니다" };
  }
  const promoteError = await updateLearning(admin, opts.candidate.id, {
    content: nextContent,
    status: "active",
    review_reason: null,
    merge_target: null,
    duplicate_of: null,
    merged_from: mergedFrom,
    meta: opts.candidate.meta,
    resolved_by: opts.userId,
    resolved_at: nowIso,
    confidence: 4,
    importance: 4
  });
  if (promoteError) return { ok: false, error: promoteError.message };
  const droppedOther = await deleteLearning(admin, opts.existing.id);
  if (droppedOther.error) return { ok: false, error: droppedOther.error };
  return { ok: true, keep_id: opts.candidate.id };
}

export function cachedProposal(
  meta: Record<string, unknown> | null | undefined,
  existing: string,
  incoming: string
): DuplicateProposal | null {
  const raw = meta?.luna_duplicate_review;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.existing_norm !== normalizeKnowledgeText(existing)) return null;
  if (obj.incoming_norm !== normalizeKnowledgeText(incoming)) return null;
  const kindRaw = typeof obj.kind === "string" ? obj.kind : "";
  const kind: DuplicateKind | null =
    kindRaw === "identical" ||
    kindRaw === "rewrite" ||
    kindRaw === "update" ||
    kindRaw === "keep_both" ||
    kindRaw === "conflict"
      ? kindRaw
      : null;
  if (!kind) return null;
  return {
    kind,
    sentence: typeof obj.sentence === "string" ? obj.sentence : "",
    reason: typeof obj.reason === "string" ? obj.reason : ""
  };
}

export function proposalMetaPatch(
  prev: Record<string, unknown>,
  existing: string,
  incoming: string,
  proposal: DuplicateProposal
): Record<string, unknown> {
  return {
    ...prev,
    luna_duplicate_review: {
      kind: proposal.kind,
      sentence: proposal.sentence,
      reason: proposal.reason,
      existing_norm: normalizeKnowledgeText(existing),
      incoming_norm: normalizeKnowledgeText(incoming),
      at: new Date().toISOString()
    }
  };
}
