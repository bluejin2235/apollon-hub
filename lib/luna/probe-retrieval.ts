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

export type ProbeModeAItem = {
  page_id: string;
  title: string;
  question: string;
  rank: number | null;
  bucket: ProbeHitBucket;
  top: Array<{ page_id: string; title: string }>;
  cause_guess: string | null;
};

export type ProbeModeBItem = {
  failure_id?: string;
  question: string;
  top: Array<{ page_id: string; title: string }>;
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
  items?: ProbeModeAItem[];
  misses?: ProbeModeAItem[];
  reviews?: ProbeModeBItem[];
  learned: string;
  next: string;
  pages_sampled?: number;
  questions_per_page?: number;
  llm_model?: string;
};

const HAIKU = "claude-haiku-4-5-20251001";
const QUESTIONS_PER_PAGE = 3;
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

function uniquePageRanks(sources: NotionSource[]): Array<{
  page_id: string;
  title: string;
}> {
  const out: Array<{ page_id: string; title: string }> = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const id = (s.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ page_id: id, title: (s.title || "").slice(0, 120) });
    if (out.length >= 10) break;
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

function guessMissCause(opts: {
  pageId: string;
  title: string;
  question: string;
  rank: number | null;
  chunkCount: number;
  top: Array<{ page_id: string; title: string }>;
}): string {
  if (opts.chunkCount <= 0) {
    return "청크가 없음 — 본문 색인 공백 가능";
  }
  if (opts.rank != null && opts.rank >= 10) {
    return `정답이 ${opts.rank + 1}위 — 임베딩·랭킹이 약함`;
  }
  const titleTokens = opts.title
    .toLowerCase()
    .match(/[가-힣a-z0-9]{2,}/g)
    ?.filter((t) => !/^(콘텐츠|제안서|프로젝트|미디어|완료)$/.test(t)) ?? [];
  const q = opts.question.toLowerCase();
  const titleInQ = titleTokens.some((t) => t.length >= 3 && q.includes(t));
  if (!titleInQ && titleTokens.length > 0) {
    return "본문·고유명사 질문인데 제목 단서가 약함 — 본문 색인/청크 분할 점검";
  }
  if (opts.top.length === 0) {
    return "검색 0건 — 키워드·임베딩 모두 미매칭";
  }
  return "정답이 상위 10 밖 — 임베딩 약함 또는 청크 절단 의심";
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

async function generateQuestionsForPage(opts: {
  title: string;
  body: string;
}): Promise<{ questions: string[]; cost_usd: number; llm_calls: number }> {
  const system =
    "당신은 검색 평가용 질문을 만듭니다. 반드시 JSON 배열만 출력하세요. " +
    "질문 3개는 이 문서의 내용으로만 답할 수 있어야 하고, " +
    "다른 일반 문서에도 걸릴 법한 흔한 단어(프로그램, 제안서, 일정 등)만으로 성립하면 안 됩니다. " +
    "고유명사·구체적 사실·수치·고유 표현을 쓰세요.";
  const user =
    `문서 제목: ${opts.title}\n\n본문 일부:\n${opts.body || "(본문 없음)"}\n\n` +
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
): Promise<Array<{ page_id: string; title: string }>> {
  const outcome = await searchNotionForLuna(admin, question, question, {
    skipLive: true
  });
  return uniquePageRanks(outcome.sources ?? []);
}

async function samplePagesWithChunks(
  admin: SupabaseClient,
  limit: number
): Promise<Array<{ page_id: string; title: string }>> {
  // 최근 색인 페이지 후보를 넉넉히 가져온 뒤 청크 있는 것만
  const { data, error } = await admin
    .from("luna_notion_pages")
    .select("page_id, title")
    .eq("archived", false)
    .not("title", "is", null)
    .order("indexed_at", { ascending: false })
    .limit(Math.max(limit * 8, 120));
  if (error) throw new Error(error.message);

  const out: Array<{ page_id: string; title: string }> = [];
  for (const row of data ?? []) {
    const page_id = String(row.page_id ?? "");
    const title = String(row.title ?? "").trim();
    if (!page_id || title.length < 2) continue;
    // 연도·루트 폴더성 제목은 정답이 자식 문서로 가는 경향 → 시험 표본에서 제외
    if (/^(19|20)\d{2}$/.test(title)) continue;
    if (/^(untitled|제목 없음)$/i.test(title)) continue;
    const { count } = await admin
      .from("luna_notion_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("page_id", page_id);
    if (!count) continue;
    out.push({ page_id, title });
    if (out.length >= limit) break;
  }
  return out;
}

/** 모드 A — 문서→질문→정답 page_id 채점 */
export async function runProbeAnswerKey(
  admin: SupabaseClient,
  opts?: { pageLimit?: number; questionsPerPage?: number }
): Promise<{
  result: ProbeRetrievalResult;
  cost_usd: number;
  llm_calls: number;
}> {
  const pageLimit = opts?.pageLimit ?? 20;
  const qPerPage = opts?.questionsPerPage ?? QUESTIONS_PER_PAGE;
  const pages = await samplePagesWithChunks(admin, pageLimit);

  let cost = 0;
  let llmCalls = 0;
  const items: ProbeModeAItem[] = [];

  for (const page of pages) {
    const body = await loadPageBody(admin, page.page_id);
    let questions: string[] = [];
    try {
      const gen = await generateQuestionsForPage({
        title: page.title,
        body: body.text
      });
      questions = gen.questions.slice(0, qPerPage);
      cost += gen.cost_usd;
      llmCalls += gen.llm_calls;
    } catch (err) {
      console.error("[probe-retrieval] question gen", page.page_id, err);
      continue;
    }
    if (questions.length === 0) continue;

    for (const question of questions) {
      const top = await searchRankedPages(admin, question);
      const rankIdx = top.findIndex((t) => t.page_id === page.page_id);
      const rank = rankIdx >= 0 ? rankIdx : null;
      const bucket = bucketForRank(rank);
      const cause =
        bucket === "miss"
          ? guessMissCause({
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
        top,
        cause_guess: cause
      });
    }
  }

  const hit_at_1 = items.filter((i) => i.rank === 0).length;
  const hit_at_5 = items.filter((i) => i.rank != null && i.rank < 5).length;
  const hit_at_10 = items.filter((i) => i.rank != null && i.rank < 10).length;
  const miss = items.filter((i) => i.bucket === "miss").length;
  const probed = items.length;
  const misses = items.filter((i) => i.bucket === "miss").slice(0, 30);

  const learned =
    probed === 0
      ? "채점할 문항이 없습니다"
      : `정답 문서 기준 hit@1 ${hit_at_1} · hit@5 ${hit_at_5} · hit@10 ${hit_at_10} · miss ${miss} / ${probed}`;
  const next =
    miss > 0
      ? "miss 문항이 다음 자습 주제 — 본문 고유명사·임베딩·청크 분할을 점검"
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
      items: items.slice(0, 80),
      misses,
      learned,
      next,
      pages_sampled: pages.length,
      questions_per_page: qPerPage,
      llm_model: HAIKU
    },
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

  const pageLimit =
    typeof scope.page_limit === "number" && scope.page_limit > 0
      ? Math.min(80, Math.floor(scope.page_limit))
      : Math.min(40, Math.max(5, limit));

  const out = await runProbeAnswerKey(admin, { pageLimit });
  const miss = out.result.miss ?? 0;
  const probed = out.result.probed;
  return {
    ...out,
    outcome:
      probed === 0 ? "failed" : miss > 0 ? "improved" : "no_change"
  };
}
