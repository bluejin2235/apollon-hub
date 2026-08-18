import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { findGlossaryDuplicates } from "@/lib/glossary/duplicate";
import { loadActiveGlossaryTerms } from "@/lib/glossary/duplicate-service";
import { isGlossaryCandidate, parseGlossaryMeta } from "@/lib/luna/candidate-format";
import {
  normalizeThread,
  resolveCandidateSource,
  type CandidateSource,
  type ThreadTurn
} from "@/lib/luna/candidates";
import {
  cachedProposal,
  dropIdenticalCandidate,
  findDuplicateMatches,
  isIdenticalKnowledge,
  isSameTopic,
  loadActiveKnowledge,
  pickOldestActive,
  proposalMetaPatch,
  proposeDuplicate,
  proposeNewKnowledge,
  tryMarkNotDuplicate,
  trySetDuplicateOf,
  type ActiveKnowledge,
  type DuplicateProposal
} from "@/lib/luna/knowledge-duplicate";

export const runtime = "nodejs";

export type PendingFilter =
  | "all"
  | "chat"
  | "selfstudy"
  | "question"
  | "direct"
  | "interview"
  | "glossary";

type LearningRow = {
  id: string;
  content: string;
  category: string;
  status: string;
  source: string | null;
  origin: string;
  evidence: string | null;
  scope_suggestion: string | null;
  thread: unknown;
  author_id: string | null;
  assigned_to: string | null;
  source_conversation_id: string | null;
  source_id: string | null;
  created_at: string | null;
  snoozed_until: string | null;
  meta: Record<string, unknown> | null;
  review_reason: string | null;
  merge_target: string | null;
  duplicate_of: string | null;
  raw_input: string | null;
};

export type DuplicateCompare = {
  id: string;
  content: string;
  created_at: string | null;
  source: string | null;
  version_count: number;
  extra_count: number;
  extras: { id: string; content: string }[];
};

export type ReviewProposal = {
  kind: DuplicateProposal["kind"] | "new";
  sentence: string;
  reason: string;
};

export type CandidateItem = Omit<LearningRow, "source"> & {
  author_name: string | null;
  assigned_name: string | null;
  thread: ThreadTurn[];
  source: CandidateSource;
  source_title: string | null;
  is_glossary: boolean;
  glossary_already_exists: boolean;
  glossary_match: {
    id: string;
    term_ko: string;
    definition: string;
    version: number;
    updated_at: string | null;
  } | null;
  glossary_proposal: {
    term_ko: string;
    definition: string;
    mode: "insert" | "update";
  } | null;
  is_my_turn: boolean;
  duplicate: DuplicateCompare | null;
  proposal: ReviewProposal | null;
};

export type CandidateCounts = {
  all: number;
  chat: number;
  selfstudy: number;
  question: number;
  direct: number;
  interview: number;
  glossary: number;
};

const SELECT_WITH_DUP =
  "id, content, category, status, source, origin, evidence, scope_suggestion, thread, author_id, assigned_to, source_conversation_id, source_id, created_at, snoozed_until, meta, review_reason, merge_target, duplicate_of, raw_input";
const SELECT_NO_DUP =
  "id, content, category, status, source, origin, evidence, scope_suggestion, thread, author_id, assigned_to, source_conversation_id, source_id, created_at, snoozed_until, meta, review_reason, merge_target, raw_input";

function isSnoozed(row: LearningRow): boolean {
  if (!row.snoozed_until) return false;
  const until = new Date(String(row.snoozed_until)).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function asMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

type AdminClient = NonNullable<ReturnType<typeof getServiceSupabase>>;

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const filter: PendingFilter =
    filterRaw === "chat" ||
    filterRaw === "selfstudy" ||
    filterRaw === "question" ||
    filterRaw === "direct" ||
    filterRaw === "interview" ||
    filterRaw === "glossary"
      ? filterRaw
      : "all";
  const proposeAll = request.nextUrl.searchParams.get("propose_all") === "1";

  const listed = await admin
    .from("luna_learnings")
    .select(SELECT_WITH_DUP)
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: true });

  let listedError = listed.error;
  let listedData = listed.data as LearningRow[] | null;

  if (listedError && /duplicate_of/i.test(listedError.message)) {
    const fallback = await admin
      .from("luna_learnings")
      .select(SELECT_NO_DUP)
      .eq("status", "candidate")
      .neq("category", "identity")
      .order("created_at", { ascending: true });
    listedError = fallback.error;
    listedData = ((fallback.data ?? []) as Omit<LearningRow, "duplicate_of">[]).map(
      (r) => ({ ...r, duplicate_of: null })
    );
  }

  if (listedError) {
    console.error("[luna/candidates] list", listedError);
    return NextResponse.json({ error: listedError.message }, { status: 500 });
  }

  const allRows = (listedData ?? []).map((r) => ({
    ...r,
    duplicate_of: r.duplicate_of ?? null
  }));
  const rows = allRows.filter((r) => !isSnoozed(r));

  const actives = await loadActiveKnowledge(admin);
  const activeById = new Map(actives.map((a) => [a.id, a]));

  const surviving: LearningRow[] = [];
  for (const row of rows) {
    const isGlossary = isGlossaryCandidate(row.meta, row.category);
    if (isGlossary) {
      surviving.push(row);
      continue;
    }

    let matchId =
      (typeof row.duplicate_of === "string" && row.duplicate_of) ||
      (typeof row.merge_target === "string" && row.merge_target) ||
      "";
    let existing = matchId ? activeById.get(matchId) ?? null : null;
    if (existing && !isSameTopic(row.content, existing.content)) {
      await tryMarkNotDuplicate(admin, row.id);
      row.duplicate_of = null;
      row.merge_target = null;
      row.review_reason = "new";
      existing = null;
      matchId = "";
    }
    if (!matchId || !existing) {
      const matches = findDuplicateMatches(row.content, actives, row.id);
      const primary = pickOldestActive(matches);
      matchId = primary?.id ?? "";
      existing = primary ?? null;
    }
    if (matchId && existing) {
      if (isIdenticalKnowledge(row.content, existing.content)) {
        await dropIdenticalCandidate(admin, row.id);
        continue;
      }
      if (row.duplicate_of !== matchId || row.review_reason !== "duplicate") {
        await trySetDuplicateOf(admin, row.id, matchId);
        row.duplicate_of = matchId;
        row.merge_target = matchId;
        row.review_reason = "duplicate";
      }
    }
    surviving.push(row);
  }

  const counts: CandidateCounts = {
    all: surviving.length,
    chat: 0,
    selfstudy: 0,
    question: 0,
    direct: 0,
    interview: 0,
    glossary: 0
  };
  let duplicateCount = 0;
  let freshCount = 0;
  for (const r of surviving) {
    const src = resolveCandidateSource(r.source, r.origin);
    if (src === "chat") counts.chat += 1;
    if (src === "selfstudy") counts.selfstudy += 1;
    if (src === "question") counts.question += 1;
    if (src === "direct") counts.direct += 1;
    if (src === "interview") counts.interview += 1;
    const glossary = isGlossaryCandidate(r.meta, r.category);
    if (glossary) counts.glossary += 1;
    const isDup =
      r.review_reason === "duplicate" || Boolean(r.duplicate_of || r.merge_target);
    if (!glossary && isDup) duplicateCount += 1;
    if (!glossary && !isDup) freshCount += 1;
  }

  let filtered = surviving;
  if (
    filter === "chat" ||
    filter === "selfstudy" ||
    filter === "question" ||
    filter === "direct" ||
    filter === "interview"
  ) {
    filtered = surviving.filter(
      (r) => resolveCandidateSource(r.source, r.origin) === filter
    );
  } else if (filter === "glossary") {
    filtered = surviving.filter((r) => isGlossaryCandidate(r.meta, r.category));
  }

  const nameIds = Array.from(
    new Set(
      filtered
        .flatMap((r) => [r.author_id, r.assigned_to])
        .filter((id): id is string => Boolean(id))
    )
  );
  const nameMap = new Map<string, string>();
  if (nameIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", nameIds);
    for (const p of profiles ?? []) {
      nameMap.set(
        p.id as string,
        ((p.name as string) || "").trim() || "이름 없음"
      );
    }
  }

  const sourceIds = Array.from(
    new Set(
      filtered
        .map((r) => r.source_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const sourceTitleMap = new Map<string, string>();
  if (sourceIds.length > 0) {
    const { data: sources } = await admin
      .from("luna_knowledge_sources")
      .select("id, title")
      .in("id", sourceIds);
    for (const s of sources ?? []) {
      const title = typeof s.title === "string" ? s.title.trim() : "";
      if (title) sourceTitleMap.set(s.id as string, title);
    }
  }

  const matchIds = Array.from(
    new Set(
      filtered
        .map((r) => r.duplicate_of || r.merge_target)
        .filter((id): id is string => Boolean(id))
    )
  );
  const versionCount = new Map<string, number>();
  if (matchIds.length > 0) {
    const { data: versions } = await admin
      .from("luna_learning_versions")
      .select("learning_id")
      .in("learning_id", matchIds);
    for (const v of versions ?? []) {
      const id = typeof v.learning_id === "string" ? v.learning_id : "";
      if (!id) continue;
      versionCount.set(id, (versionCount.get(id) ?? 0) + 1);
    }
  }

  const glossaryTerms = await loadActiveGlossaryTerms(admin);

  const PROPOSE_LIMIT = 20;
  const proposeIndexes = new Set<number>();
  if (proposeAll) {
    filtered.forEach((r, i) => {
      if (!isGlossaryCandidate(r.meta, r.category)) proposeIndexes.add(i);
    });
  } else {
    let n = 0;
    for (let i = 0; i < filtered.length; i += 1) {
      if (n >= PROPOSE_LIMIT) break;
      const row = filtered[i]!;
      if (isGlossaryCandidate(row.meta, row.category)) continue;
      proposeIndexes.add(i);
      n += 1;
    }
  }

  const items: CandidateItem[] = [];
  for (let i = 0; i < filtered.length; i += 1) {
    const r = filtered[i]!;
    const source = resolveCandidateSource(r.source, r.origin);
    const thread = normalizeThread(r.thread);
    const isMyTurn =
      source === "question" &&
      r.assigned_to === user.id &&
      thread.length > 0 &&
      thread[thread.length - 1]?.role === "luna";
    const isGlossary = isGlossaryCandidate(r.meta, r.category);
    let glossary_already_exists = false;
    let glossary_match: CandidateItem["glossary_match"] = null;
    let glossary_proposal: CandidateItem["glossary_proposal"] = null;
    if (isGlossary) {
      const draft = parseGlossaryMeta(r.meta, r.content);
      const dup = findGlossaryDuplicates(draft, glossaryTerms);
      glossary_already_exists = dup.conflicts;
      if (dup.existing) {
        glossary_match = {
          id: dup.existing.id,
          term_ko: dup.existing.term_ko,
          definition: dup.existing.definition ?? "",
          version: dup.existing.version,
          updated_at: dup.existing.updated_at
        };
      }
      glossary_proposal = {
        term_ko: draft.term_ko,
        definition: draft.definition,
        mode: glossary_match ? "update" : "insert"
      };
    }

    const matchId = r.duplicate_of || r.merge_target;
    const existing = matchId ? activeById.get(matchId) ?? null : null;
    let duplicate: DuplicateCompare | null = null;
    if (existing) {
      const extras = findDuplicateMatches(r.content, actives, r.id).filter(
        (m) => m.id !== existing.id
      );
      duplicate = {
        id: existing.id,
        content: existing.content,
        created_at: existing.created_at,
        source: existing.source ?? null,
        version_count: versionCount.get(existing.id) ?? 0,
        extra_count: extras.length,
        extras: extras.slice(0, 5).map((m) => ({
          id: m.id,
          content: m.content
        }))
      };
    }

    let proposal: ReviewProposal | null = null;
    if (proposeIndexes.has(i) && !isGlossary) {
      proposal = await buildProposal(admin, r, existing);
      if (proposal?.kind === "identical") {
        continue;
      }
    } else if (existing) {
      const cached = cachedProposal(r.meta, existing.content, r.content);
      if (cached && cached.kind !== "identical") {
        proposal = cached;
      }
    }

    items.push({
      ...r,
      source,
      source_title: r.source_id
        ? sourceTitleMap.get(r.source_id) ?? null
        : null,
      thread,
      is_glossary: isGlossary,
      glossary_already_exists,
      glossary_match,
      glossary_proposal,
      is_my_turn: isMyTurn,
      author_name: r.author_id ? nameMap.get(r.author_id) ?? null : null,
      assigned_name: r.assigned_to ? nameMap.get(r.assigned_to) ?? null : null,
      duplicate,
      proposal
    });
  }

  const myTurnCount = surviving.filter(
    (r) =>
      resolveCandidateSource(r.source, r.origin) === "question" &&
      r.assigned_to === user.id
  ).length;

  return NextResponse.json({
    items,
    count: items.length,
    counts,
    queue: {
      total: surviving.length,
      duplicate: duplicateCount,
      fresh: freshCount
    },
    my_turn_count: myTurnCount,
    current_user_id: user.id
  });
}

async function buildProposal(
  admin: AdminClient,
  row: LearningRow,
  existing: ActiveKnowledge | null
): Promise<ReviewProposal | null> {
  const meta = asMeta(row.meta);

  if (existing) {
    const cached = cachedProposal(meta, existing.content, row.content);
    if (cached && cached.kind !== "identical") return cached;
    const proposal = await proposeDuplicate(admin, {
      existing: existing.content,
      incoming: row.content,
      mergeDraft: row.raw_input
    });
    if (proposal.kind === "identical") {
      await dropIdenticalCandidate(admin, row.id);
      return proposal;
    }
    const nextMeta = proposalMetaPatch(meta, existing.content, row.content, proposal);
    await admin
      .from("luna_learnings")
      .update({ meta: nextMeta })
      .eq("id", row.id);
    return proposal;
  }

  const cachedNew = meta.luna_new_review;
  if (cachedNew && typeof cachedNew === "object" && !Array.isArray(cachedNew)) {
    const obj = cachedNew as Record<string, unknown>;
    if (
      typeof obj.sentence === "string" &&
      obj.incoming_norm === row.content.replace(/\s+/g, " ").trim().toLowerCase()
    ) {
      return {
        kind: "new",
        sentence: obj.sentence,
        reason: typeof obj.reason === "string" ? obj.reason : ""
      };
    }
  }

  const fresh = await proposeNewKnowledge(admin, row.content);
  await admin
    .from("luna_learnings")
    .update({
      meta: {
        ...meta,
        luna_new_review: {
          sentence: fresh.sentence,
          reason: fresh.reason,
          incoming_norm: row.content.replace(/\s+/g, " ").trim().toLowerCase(),
          at: new Date().toISOString()
        }
      }
    })
    .eq("id", row.id);
  return { kind: "new", ...fresh };
}
