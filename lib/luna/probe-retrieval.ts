/**
 * probe_retrieval — 정답(문서 id) 기반 검색 채점
 *
 * 모드 A: 문서 → 질문 생성 → 그 문서가 상위 k에 있는지 (자동 채점)
 * 모드 B: 실패 기록 질문 → 결과만 기록, 사람에게 확인 (hit/miss 없음)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmComplete } from "@/lib/luna/llm/client";
import { resolveOfficialPrice } from "@/lib/luna/model-pricing";
import { searchNotionForLuna } from "@/lib/luna/notion-index-search";
import type { NotionSource } from "@/lib/luna/notion";

export type ProbeHitBucket = "hit@1" | "hit@5" | "hit@10" | "miss";

/** 맞은 이유 — exact=그 문서, same_project=같은 프로젝트의 다른 문서 */
export type ProbeMatchKind = "exact" | "same_project";

/** miss 분류 — 다음날 아젠다 입력 */
export type MissCauseKind =
  | "proper_noun_body_only"
  | "weak_embedding"
  | "bad_chunk"
  | "no_chunks"
  | "no_results"
  | "wrong_label"
  | "bad_question"
  | "other";

export const MISS_CAUSE_LABEL: Record<MissCauseKind, string> = {
  proper_noun_body_only: "본문에만 있는 고유명사",
  weak_embedding: "임베딩이 약함",
  bad_chunk: "청크가 잘못 잘림",
  no_chunks: "청크가 없음",
  no_results: "검색 0건",
  wrong_label: "정답 레이블이 틀림",
  bad_question: "질문이 나쁨",
  other: "원인 불명"
};

export type ProbeTopHit = {
  page_id: string;
  title: string;
  /** 0-based 저장 순위 */
  rank: number;
  /** match_score 또는 similarity 기반 */
  score: number | null;
  /** keyword | embedding | both | link 등 */
  match_via?: string | null;
};

/** 모드 A — 검색 overfetch 후보 저장 건수 (리랭크 실험용) */
export const MODE_A_TOP_STORE = 50;

export type ProbeModeAItem = {
  page_id: string;
  title: string;
  question: string;
  rank: number | null;
  bucket: ProbeHitBucket;
  /** hit 일 때 — exact | same_project */
  match_kind?: ProbeMatchKind | null;
  top: ProbeTopHit[];
  cause_guess: string | null;
  cause_kind?: MissCauseKind | null;
  /** glossary | image | knowledge | wiki | notion | work */
  source?: string;
};

export type ProbeModeBItem = {
  failure_id?: string;
  question: string;
  top: ProbeTopHit[];
  ask_human: string;
};

export type ProbeRetrievalResult = {
  mode: "answer_key" | "failure_review";
  probed: number;
  hit_at_1?: number;
  hit_at_5?: number;
  hit_at_10?: number;
  miss?: number;
  miss_rate?: number;
  /** hit 중 정확히 그 문서 */
  exact?: number;
  /** hit 중 같은 프로젝트의 다른 문서 */
  same_project?: number;
  miss_by_cause?: Record<string, number>;
  items?: ProbeModeAItem[];
  misses?: ProbeModeAItem[];
  reviews?: ProbeModeBItem[];
  learned: string;
  next: string;
  pages_sampled?: number;
  questions_per_page?: number;
  llm_model?: string;
  /** 오늘 이미 본 대상. 다음 청크가 같은 용어·이미지를 다시 안 돌리게 */
  page_ids?: string[];
};

/** 하루 목표 문서 수 (여러 청크로 나눔) */
export const MODE_A_PAGE_LIMIT = 200;
/** Vercel 한 호출에서 돌릴 문서 수 — 300~800초 예산에 맞춤 */
export const MODE_A_BATCH_SIZE = 20;
export const MODE_A_QUESTIONS_PER_PAGE = 3;
export const MODE_A_MINUTES = 30;
/** 한 청크 예산(ms). 바깥 루프를 끊는 값이 아니다. 청크가 이 안에 finishRun 하게 하는 상한 */
export const MODE_A_CHUNK_BUDGET_MS = 240_000;
/** 문서 단위 병렬. 순차 20문서가 예산 240초를 다 써서 청크가 3번에서 멈추던 것을 줄인다 */
export const MODE_A_PAGE_CONCURRENCY = 4;

const HAIKU = "claude-haiku-4-5-20251001";
const QUESTIONS_PER_PAGE = MODE_A_QUESTIONS_PER_PAGE;
const BODY_CHARS = 2800;

function usageCostUsd(modelId: string, usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  const price = resolveOfficialPrice(modelId);
  if (!price) return 0;
  const inTok = Math.max(0, usage.input_tokens || 0);
  const outTok = Math.max(0, usage.output_tokens || 0);
  const cw = Math.max(0, usage.cache_creation_input_tokens || 0);
  const cr = Math.max(0, usage.cache_read_input_tokens || 0);
  const write = price.cache_write ?? price.input * 1.25;
  const read = price.cache_read ?? price.input * 0.1;
  return (
    (inTok * price.input +
      outTok * price.output +
      cw * write +
      cr * read) /
    1_000_000
  );
}

function uniquePageRanks(
  sources: NotionSource[],
  limit = MODE_A_TOP_STORE
): ProbeTopHit[] {
  const out: ProbeTopHit[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const id = (s.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const score =
      typeof s.match_score === "number" && Number.isFinite(s.match_score)
        ? s.match_score
        : typeof s.similarity === "number" && Number.isFinite(s.similarity)
          ? s.similarity
          : null;
    out.push({
      page_id: id,
      title: (s.title || "").slice(0, 120),
      rank: out.length,
      score,
      match_via: s.match_via ?? (s.link_expanded ? "link" : null)
    });
    if (out.length >= limit) break;
  }
  return out;
}

function bucketForRank(rank: number | null): ProbeHitBucket {
  if (rank == null) return "miss";
  if (rank === 0) return "hit@1";
  if (rank < 5) return "hit@5";
  if (rank < 10) return "hit@10";
  return "miss";
}

/**
 * page_id → belongs 대상(to_id) 집합.
 * 제목 비교는 쓰지 않는다 — 같은 제목·다른 회차가 있다.
 */
export async function loadBelongsProjectIds(
  admin: SupabaseClient,
  pageIds: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const ids = [...new Set(pageIds.map((id) => id.trim()).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("luna_links")
      .select("from_id, to_id")
      .eq("kind", "belongs")
      .eq("status", "active")
      .in("from_id", slice);
    if (error) {
      console.error("[probe-retrieval] belongs", error);
      continue;
    }
    for (const row of data ?? []) {
      const from = String((row as { from_id?: string }).from_id ?? "").trim();
      const to = String((row as { to_id?: string }).to_id ?? "").trim();
      if (!from || !to) continue;
      const set = map.get(from) ?? new Set<string>();
      set.add(to);
      map.set(from, set);
    }
  }
  return map;
}

/** 두 페이지가 같은 프로젝트에 속하는지 (belongs to_id 교집합 또는 한쪽이 상대의 허브) */
export function pagesShareProject(
  answerPageId: string,
  foundPageId: string,
  belongsTo: Map<string, Set<string>>
): boolean {
  const a = answerPageId.trim();
  const b = foundPageId.trim();
  if (!a || !b || a === b) return false;
  const ta = belongsTo.get(a);
  const tb = belongsTo.get(b);
  if (ta && tb) {
    for (const p of ta) {
      if (tb.has(p)) return true;
    }
  }
  // found → answer(허브) 또는 answer → found(허브)
  if (tb?.has(a)) return true;
  if (ta?.has(b)) return true;
  return false;
}

/**
 * 정답 page_id 또는 같은 프로젝트 문서가 top 에 있으면 hit.
 * belongs 가 없으면 exact 만 인정.
 */
export function scoreProbeAgainstTop(
  answerPageId: string,
  top: Array<{ page_id: string }>,
  belongsTo: Map<string, Set<string>>
): {
  rank: number | null;
  bucket: ProbeHitBucket;
  match_kind: ProbeMatchKind | null;
} {
  let exactRank: number | null = null;
  let sameRank: number | null = null;
  for (let i = 0; i < top.length; i += 1) {
    const id = (top[i]?.page_id ?? "").trim();
    if (!id) continue;
    if (id === answerPageId) {
      if (exactRank == null) exactRank = i;
      continue;
    }
    if (sameRank == null && pagesShareProject(answerPageId, id, belongsTo)) {
      sameRank = i;
    }
  }
  let rank: number | null = null;
  let match_kind: ProbeMatchKind | null = null;
  if (exactRank != null && (sameRank == null || exactRank <= sameRank)) {
    rank = exactRank;
    match_kind = "exact";
  } else if (sameRank != null) {
    rank = sameRank;
    match_kind = "same_project";
  }
  return { rank, bucket: bucketForRank(rank), match_kind };
}

function looksLikeBadQuestion(question: string): boolean {
  const s = question.trim();
  if (s.length < 16) return true;
  if (/^(이|그|해당)\s*문서/.test(s)) return true;
  if (/문서의\s*(주제|내용|제목|요지|핵심)/.test(s)) return true;
  if (
    /무엇인가요\?$|무엇인가\?$|알려주세요\.?$/.test(s) &&
    s.length < 28
  ) {
    return true;
  }
  return false;
}

function classifyMissCause(opts: {
  pageId: string;
  title: string;
  question: string;
  rank: number | null;
  chunkCount: number;
  top: Array<{ page_id: string; title: string }>;
}): { kind: MissCauseKind; label: string } {
  if (opts.chunkCount <= 0) {
    return { kind: "no_chunks", label: MISS_CAUSE_LABEL.no_chunks };
  }
  if (opts.top.length === 0) {
    return { kind: "no_results", label: MISS_CAUSE_LABEL.no_results };
  }
  if (looksLikeBadQuestion(opts.question)) {
    return { kind: "bad_question", label: MISS_CAUSE_LABEL.bad_question };
  }
  const titleTokens =
    opts.title
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g)
      ?.filter((t) => !/^(콘텐츠|제안서|프로젝트|미디어|완료)$/.test(t)) ?? [];
  const q = opts.question.toLowerCase();
  const titleInQ = titleTokens.some((t) => t.length >= 3 && q.includes(t));
  // 질문에 제목 단서가 거의 없고 본문 고유명사성 질문이면
  if (!titleInQ && titleTokens.length > 0) {
    return {
      kind: "proper_noun_body_only",
      label: MISS_CAUSE_LABEL.proper_noun_body_only
    };
  }
  // 정답이 멀리 있으면 임베딩 약함
  if (opts.rank != null && opts.rank >= 10) {
    return { kind: "weak_embedding", label: MISS_CAUSE_LABEL.weak_embedding };
  }
  // 상위에는 다른 문서만 — 청크 절단·분할 의심
  if (opts.rank == null && opts.top.length > 0) {
    return { kind: "bad_chunk", label: MISS_CAUSE_LABEL.bad_chunk };
  }
  return { kind: "other", label: MISS_CAUSE_LABEL.other };
}

function parseQuestionsJson(raw: string): string[] {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fence ? fence[1]!.trim() : trimmed;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((x) => (typeof x === "string" ? x : String((x as { q?: string })?.q ?? "")))
        .map((s) => s.trim())
        .filter((s) => s.length >= 4)
        .slice(0, QUESTIONS_PER_PAGE);
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)) {
      return ((parsed as { questions: unknown[] }).questions)
        .map((x) => (typeof x === "string" ? x : ""))
        .map((s) => s.trim())
        .filter((s) => s.length >= 4)
        .slice(0, QUESTIONS_PER_PAGE);
    }
  } catch {
    // fall through
  }
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[\d]+[.)]\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter((s) => s.length >= 4 && /[가-힣a-zA-Z?]/.test(s))
    .slice(0, QUESTIONS_PER_PAGE);
}

async function loadPageBody(
  admin: SupabaseClient,
  pageId: string
): Promise<{ text: string; chunkCount: number }> {
  const { data, count } = await admin
    .from("luna_notion_chunks")
    .select("heading, text", { count: "exact" })
    .eq("page_id", pageId)
    .order("position", { ascending: true })
    .limit(12);
  const parts: string[] = [];
  for (const row of data ?? []) {
    const h = typeof row.heading === "string" ? row.heading.trim() : "";
    const t = typeof row.text === "string" ? row.text.trim() : "";
    if (h) parts.push(`[${h}]`);
    if (t) parts.push(t);
  }
  const text = parts.join("\n").slice(0, BODY_CHARS);
  return { text, chunkCount: count ?? (data ?? []).length };
}

export async function generateQuestionsForPage(opts: {
  title: string;
  body: string;
  source?: "wiki" | "work" | "notion";
}): Promise<{ questions: string[]; cost_usd: number; llm_calls: number }> {
  const wiki = opts.source === "wiki";
  const system = wiki
    ? "당신은 검색 평가용 질문을 만듭니다. 반드시 JSON 배열만 출력하세요. " +
      "이 문서는 사내 위키다. 팀원이 실제로 물을 법한 짧은 한국어 질문 3개. " +
      "영어 프로젝트 소개를 번역·받아쓰기 퀴즈로 만들지 마라. " +
      "숫자·절차·고유 표현을 쓰되 일상 말투로. " +
      "다른 문서에도 걸릴 흔한 단어만으로 성립하면 안 된다."
    : "당신은 검색 평가용 질문을 만듭니다. 반드시 JSON 배열만 출력하세요. " +
      "질문 3개는 이 문서의 내용으로만 답할 수 있어야 하고, " +
      "다른 일반 문서에도 걸릴 법한 흔한 단어(프로그램, 제안서, 일정 등)만으로 성립하면 안 됩니다. " +
      "고유명사·구체적 사실·수치·고유 표현을 쓰세요.";
  const user = wiki
    ? `문서 제목: ${opts.title}\n\n본문 일부:\n${opts.body || "(본문 없음)"}\n\n` +
      `팀원이 이 문서를 보고 물을 법한 한국어 질문 3개를 JSON 배열로: ["질문1","질문2","질문3"]`
    : `문서 제목: ${opts.title}\n\n본문 일부:\n${opts.body || "(본문 없음)"}\n\n` +
      `이 문서로만 답할 수 있는 한국어 질문 3개를 JSON 배열로: ["질문1","질문2","질문3"]`;

  const res = await llmComplete({
    provider: "anthropic",
    model_id: HAIKU,
    system,
    user,
    maxTokens: 400
  });
  return {
    questions: parseQuestionsJson(res.text),
    cost_usd: usageCostUsd(HAIKU, res.usage),
    llm_calls: 1
  };
}

async function searchRankedPages(
  admin: SupabaseClient,
  question: string
): Promise<ProbeTopHit[]> {
  const outcome = await searchNotionForLuna(admin, question, question, {
    skipLive: true
  });
  return uniquePageRanks(outcome.sources ?? [], MODE_A_TOP_STORE);
}

function kstMidnightIso(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const utcMidnight = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate()
  );
  return new Date(utcMidnight - 9 * 60 * 60 * 1000).toISOString();
}

/** 오늘(KST) 이미 시험한 문서. 청크가 같은 최근 20건을 반복하지 않게 */
async function loadTodayProbedPageIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from("luna_study_runs")
    .select("result")
    .eq("kind", "probe_retrieval")
    .gte("started_at", kstMidnightIso())
    .order("started_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const result = row.result as {
      page_ids?: unknown;
      items?: unknown;
    } | null;
    if (Array.isArray(result?.page_ids)) {
      for (const id of result.page_ids) {
        if (typeof id === "string" && id) ids.add(id);
      }
    }
    if (Array.isArray(result?.items)) {
      for (const it of result.items) {
        const id = (it as { page_id?: string } | null)?.page_id;
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

async function samplePagesWithChunks(
  admin: SupabaseClient,
  limit: number,
  exclude: Set<string>
): Promise<Array<{ page_id: string; title: string }>> {
  const out: Array<{ page_id: string; title: string }> = [];
  const pageSize = 200;
  let offset = 0;
  const maxScan = 4000;
  while (out.length < limit && offset < maxScan) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title")
      .eq("archived", false)
      .not("title", "is", null)
      .order("indexed_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) break;

    const candidates: Array<{ page_id: string; title: string }> = [];
    for (const row of rows) {
      const page_id = String(row.page_id ?? "");
      const title = String(row.title ?? "").trim();
      if (!page_id || title.length < 2) continue;
      if (exclude.has(page_id)) continue;
      if (/^(19|20)\d{2}$/.test(title)) continue;
      if (/^(untitled|제목 없음)$/i.test(title)) continue;
      candidates.push({ page_id, title });
    }

    const withChunks = new Set<string>();
    const ids = candidates.map((c) => c.page_id);
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200);
      if (slice.length === 0) continue;
      const { data: chunkRows, error: chunkErr } = await admin
        .from("luna_notion_chunks")
        .select("page_id")
        .in("page_id", slice);
      if (chunkErr) throw new Error(chunkErr.message);
      for (const row of chunkRows ?? []) {
        if (row.page_id) withChunks.add(String(row.page_id));
      }
    }

    for (const c of candidates) {
      if (!withChunks.has(c.page_id)) continue;
      out.push(c);
      if (out.length >= limit) break;
    }
    offset += rows.length;
    if (rows.length < pageSize) break;
  }
  return out;
}

async function probeOnePage(
  admin: SupabaseClient,
  page: { page_id: string; title: string },
  qPerPage: number,
  started: number,
  budgetMs: number
): Promise<{
  items: ProbeModeAItem[];
  cost: number;
  llm: number;
  started: boolean;
  timedOut: boolean;
}> {
  if (Date.now() - started > budgetMs) {
    return { items: [], cost: 0, llm: 0, started: false, timedOut: true };
  }
  const body = await loadPageBody(admin, page.page_id);
  let questions: string[] = [];
  let cost = 0;
  let llm = 0;
  try {
    const gen = await generateQuestionsForPage({
      title: page.title,
      body: body.text
    });
    questions = gen.questions.slice(0, qPerPage);
    cost += gen.cost_usd;
    llm += gen.llm_calls;
  } catch (err) {
    console.error("[probe-retrieval] question gen", page.page_id, err);
    return { items: [], cost, llm, started: true, timedOut: false };
  }
  if (questions.length === 0) {
    return { items: [], cost, llm, started: true, timedOut: false };
  }

  const items: ProbeModeAItem[] = [];
  let timedOut = false;
  const belongsTo = await loadBelongsProjectIds(admin, [page.page_id]);
  const belongsLoaded = new Set<string>([page.page_id]);
  for (const question of questions) {
    if (Date.now() - started > budgetMs) {
      timedOut = true;
      break;
    }
    let top: ProbeTopHit[];
    try {
      top = await searchRankedPages(admin, question);
    } catch (err) {
      console.error("[probe-retrieval] search", page.page_id, err);
      continue;
    }
    const need = top
      .map((t) => t.page_id.trim())
      .filter((id) => id && !belongsLoaded.has(id));
    if (need.length > 0) {
      const extra = await loadBelongsProjectIds(admin, need);
      for (const id of need) belongsLoaded.add(id);
      for (const [k, v] of extra) belongsTo.set(k, v);
    }
    const { rank, bucket, match_kind } = scoreProbeAgainstTop(
      page.page_id,
      top,
      belongsTo
    );
    const cause =
      bucket === "miss"
        ? classifyMissCause({
            pageId: page.page_id,
            title: page.title,
            question,
            rank,
            chunkCount: body.chunkCount,
            top
          })
        : null;
    items.push({
      page_id: page.page_id,
      title: page.title,
      question,
      rank,
      bucket,
      match_kind,
      top,
      cause_guess: cause?.label ?? null,
      cause_kind: cause?.kind ?? null
    });
  }
  return { items, cost, llm, started: true, timedOut };
}

/** 모드 A — 문서→질문→정답 page_id 채점 */
export async function runProbeAnswerKey(
  admin: SupabaseClient,
  opts?: {
    pageLimit?: number;
    questionsPerPage?: number;
    budgetMs?: number;
  }
): Promise<{
  result: ProbeRetrievalResult;
  cost_usd: number;
  llm_calls: number;
}> {
  const pageLimit = opts?.pageLimit ?? MODE_A_BATCH_SIZE;
  const qPerPage = opts?.questionsPerPage ?? QUESTIONS_PER_PAGE;
  const budgetMs = opts?.budgetMs ?? MODE_A_CHUNK_BUDGET_MS;
  const started = Date.now();
  const exclude = await loadTodayProbedPageIds(admin);
  const pages = await samplePagesWithChunks(admin, pageLimit, exclude);

  const outcomes: Array<Awaited<ReturnType<typeof probeOnePage>>> = new Array(pages.length);
  let cursor = 0;
  const workers = Math.min(MODE_A_PAGE_CONCURRENCY, pages.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < pages.length) {
        const idx = cursor;
        cursor += 1;
        const page = pages[idx];
        if (!page) return;
        try {
          outcomes[idx] = await probeOnePage(admin, page, qPerPage, started, budgetMs);
        } catch (err) {
          console.error("[probe-retrieval] page", page.page_id, err);
          outcomes[idx] = {
            items: [],
            cost: 0,
            llm: 0,
            started: true,
            timedOut: false
          };
        }
      }
    })
  );

  let cost = 0;
  let llmCalls = 0;
  const items: ProbeModeAItem[] = [];
  const pageIds: string[] = [];
  let timedOut = false;
  let pagesAttempted = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const out = outcomes[i];
    if (!out || !out.started) {
      timedOut = true;
      continue;
    }
    pagesAttempted += 1;
    pageIds.push(page.page_id);
    items.push(...out.items);
    cost += out.cost;
    llmCalls += out.llm;
    if (out.timedOut) timedOut = true;
  }

  const hit_at_1 = items.filter((i) => i.rank === 0).length;
  const hit_at_5 = items.filter((i) => i.rank != null && i.rank < 5).length;
  const hit_at_10 = items.filter((i) => i.rank != null && i.rank < 10).length;
  const miss = items.filter((i) => i.bucket === "miss").length;
  const exact = items.filter((i) => i.match_kind === "exact").length;
  const same_project = items.filter((i) => i.match_kind === "same_project").length;
  const probed = items.length;
  const misses = items.filter((i) => i.bucket === "miss").slice(0, 30);
  const miss_by_cause: Record<string, number> = {};
  for (const m of items) {
    if (m.bucket !== "miss" || !m.cause_kind) continue;
    miss_by_cause[m.cause_kind] = (miss_by_cause[m.cause_kind] ?? 0) + 1;
  }

  const learned =
    probed === 0
      ? "채점할 문항이 없습니다"
      : `hit@1 ${hit_at_1} · hit@5 ${hit_at_5} · hit@10 ${hit_at_10} · miss ${miss} / ${probed} (exact ${exact} · same_project ${same_project})`;
  const topMissCause = Object.entries(miss_by_cause).sort((a, b) => b[1] - a[1])[0];
  const next =
    miss > 0 && topMissCause
      ? `miss 주원인: ${MISS_CAUSE_LABEL[topMissCause[0] as MissCauseKind] ?? topMissCause[0]} (${topMissCause[1]}건) — 다음날 아젠다 입력`
      : miss > 0
        ? "miss 문항이 다음 자습 주제"
        : "표본을 늘리거나 실패 기록(모드 B) 사람 확인으로 이동";

  return {
    result: {
      mode: "answer_key",
      probed,
      hit_at_1,
      hit_at_5,
      hit_at_10,
      miss,
      miss_rate: probed ? Number((miss / probed).toFixed(3)) : 0,
      exact,
      same_project,
      miss_by_cause,
      items: items.slice(0, 80),
      misses,
      learned: timedOut
        ? `${learned} · 시간 예산으로 ${pagesAttempted}/${pages.length}문서에서 중단(부분 저장)`
        : learned,
      next: timedOut
        ? `다음 청크 이어가기 (하루 목표 ${MODE_A_PAGE_LIMIT}문서)`
        : next,
      pages_sampled: pagesAttempted,
      page_ids: pageIds,
      questions_per_page: qPerPage,
      llm_model: HAIKU,
      ...(timedOut
        ? {
            partial: true,
            budget_ms: budgetMs,
            pages_target: pages.length
          }
        : {})
    } as ProbeRetrievalResult & Record<string, unknown>,
    cost_usd: Number(cost.toFixed(6)),
    llm_calls: llmCalls
  };
}

/** 모드 B — 실패 질문: 결과만 기록, hit/miss 집계 없음 */
export async function runProbeFailureReview(
  admin: SupabaseClient,
  scope: Record<string, unknown>,
  limit: number
): Promise<{
  result: ProbeRetrievalResult;
  cost_usd: number;
  llm_calls: number;
}> {
  const failureIds = Array.isArray(scope.failure_ids)
    ? (scope.failure_ids as string[]).slice(0, limit)
    : [];

  let questions: Array<{ failure_id?: string; question: string }> = [];
  if (failureIds.length > 0) {
    const { data: fails } = await admin
      .from("luna_failures")
      .select("id, question")
      .in("id", failureIds);
    questions = (fails ?? [])
      .map((f) => ({
        failure_id: String(f.id),
        question: String(f.question ?? "").trim()
      }))
      .filter((q) => q.question.length >= 2)
      .slice(0, limit);
  }

  const reviews: ProbeModeBItem[] = [];
  for (const q of questions) {
    const top = await searchRankedPages(admin, q.question);
    reviews.push({
      failure_id: q.failure_id,
      question: q.question.slice(0, 200),
      top,
      ask_human:
        top.length === 0
          ? "검색 결과가 없습니다. 기대 문서가 있나요?"
          : `상위 결과: ${top
              .slice(0, 3)
              .map((t) => t.title || t.page_id)
              .join(" · ")} — 이게 맞나요?`
    });
  }

  return {
    result: {
      mode: "failure_review",
      probed: reviews.length,
      reviews,
      learned:
        "실패 기록 질문은 정답을 모르므로 자동 hit/miss 하지 않았습니다. 사람 확인이 필요합니다.",
      next: "ask_human 항목을 블루진이 확인하면 정답 page_id를 붙여 모드 A 세트로 승격"
    },
    cost_usd: 0,
    llm_calls: 0
  };
}

export async function runProbeRetrievalExam(
  admin: SupabaseClient,
  scope: Record<string, unknown>,
  limit: number
): Promise<{
  result: ProbeRetrievalResult;
  outcome: "improved" | "no_change" | "failed";
  cost_usd: number;
  llm_calls: number;
}> {
  const mode =
    typeof scope.mode === "string"
      ? scope.mode
      : Array.isArray(scope.failure_ids) && (scope.failure_ids as unknown[]).length > 0
        ? "failure_review"
        : "answer_key";

  if (mode === "failure_review") {
    const out = await runProbeFailureReview(admin, scope, limit);
    return {
      ...out,
      outcome: out.result.probed > 0 ? "no_change" : "failed"
    };
  }

  // scope.page_limit 이 과거 값(200)으로 남아 있어도 한 호출당 BATCH_SIZE 로 클램프
  const pageLimit =
    typeof scope.page_limit === "number" && scope.page_limit > 0
      ? Math.min(MODE_A_BATCH_SIZE, Math.floor(scope.page_limit))
      : typeof limit === "number" && limit > 0
        ? Math.min(MODE_A_BATCH_SIZE, limit)
        : MODE_A_BATCH_SIZE;

  const { isMultiSourceModeAEnabled, runModeAMultiSource, MODE_A_CALL_BUDGET_MS } =
    await import("@/lib/luna/probe-mode-a-sources");

  if (isMultiSourceModeAEnabled() && scope.multi_source !== false) {
    const exclude = await loadTodayProbedPageIds(admin);
    const notionLimit =
      typeof scope.notion_limit === "number"
        ? scope.notion_limit
        : undefined;
    const multi = await runModeAMultiSource(admin, {
      budgetMs: MODE_A_CALL_BUDGET_MS,
      exclude,
      limits: {
        glossary:
          typeof scope.glossary_limit === "number"
            ? scope.glossary_limit
            : undefined,
        image:
          typeof scope.image_limit === "number" ? scope.image_limit : undefined,
        knowledge:
          typeof scope.knowledge_limit === "number"
            ? scope.knowledge_limit
            : undefined,
        wiki: typeof scope.wiki_limit === "number" ? scope.wiki_limit : undefined,
        work: typeof scope.work_limit === "number" ? scope.work_limit : undefined,
        notion: notionLimit
      },
      generateQuestions: (title, body) =>
        generateQuestionsForPage({ title, body }),
      runNotion: async (pl, budgetMs) => runProbeAnswerKey(admin, {
        pageLimit: pl,
        questionsPerPage: MODE_A_QUESTIONS_PER_PAGE,
        budgetMs
      })
    });
    const miss = multi.result.miss;
    const probed = multi.result.probed;
    return {
      result: multi.result,
      cost_usd: multi.cost_usd,
      llm_calls: multi.llm_calls,
      outcome:
        probed === 0 ? "failed" : miss > 0 ? "improved" : "no_change"
    };
  }

  const out = await runProbeAnswerKey(admin, {
    pageLimit,
    questionsPerPage: MODE_A_QUESTIONS_PER_PAGE,
    budgetMs: MODE_A_CHUNK_BUDGET_MS
  });
  const miss = out.result.miss ?? 0;
  const probed = out.result.probed;
  return {
    ...out,
    outcome:
      probed === 0 ? "failed" : miss > 0 ? "improved" : "no_change"
  };
}
