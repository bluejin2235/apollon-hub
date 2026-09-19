/**
 * 모드 A — 1차 원천별 검색 검증
 *
 * 용어·이미지·지식은 LLM 없이, 위키·노션·Work 는 질문 생성(LLM).
 * 2026-09-20(KST) 부터 다중 원천. 그 전은 노션만(기존).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { iGa } from "@/lib/korean/particles";
import {
  pickGlossaryForQuestion,
  pickLearningsForQuestion,
  type GlossaryMatchRow,
  type LearningMatchRow
} from "@/lib/luna/knowledge-match";
import { searchNasTextKeyword } from "@/lib/luna/nas-text-keyword";
import { loadWikiDocs } from "@/lib/wiki/store";
import { matchWikiSections } from "@/lib/luna/wiki-match";
import {
  MODE_A_QUESTIONS_PER_PAGE,
  MODE_A_TOP_STORE,
  type MissCauseKind,
  type ProbeHitBucket,
  type ProbeModeAItem,
  type ProbeTopHit,
  MISS_CAUSE_LABEL
} from "@/lib/luna/probe-retrieval";

function toTopHits(
  rows: Array<{
    page_id: string;
    title: string;
    score?: number | null;
    match_via?: string | null;
  }>,
  limit = MODE_A_TOP_STORE
): ProbeTopHit[] {
  return rows.slice(0, limit).map((r, i) => ({
    page_id: r.page_id,
    title: r.title,
    rank: i,
    score: r.score ?? null,
    match_via: r.match_via ?? null
  }));
}

export type ModeASourceKind =
  | "glossary"
  | "image"
  | "knowledge"
  | "wiki"
  | "notion"
  | "work";

/** KST 이 날짜부터 다중 원천. 9/18 앞당기지 않고 9/20으로 하루 미룸 — 청크 모드 A 재시도를 먼저 확인. */
export const MODE_A_MULTI_SOURCE_FROM_KST = "2026-09-20";

export const MODE_A_SOURCE_BUDGET: Record<
  ModeASourceKind,
  { daily_items: number; questions_per: number; needs_llm: boolean; minutes: number }
> = {
  glossary: { daily_items: 100, questions_per: 1, needs_llm: false, minutes: 4 },
  image: { daily_items: 200, questions_per: 1, needs_llm: false, minutes: 5 },
  knowledge: { daily_items: 20, questions_per: 1, needs_llm: false, minutes: 2 },
  wiki: { daily_items: 15, questions_per: 3, needs_llm: true, minutes: 6 },
  notion: { daily_items: 100, questions_per: 3, needs_llm: true, minutes: 14 },
  work: { daily_items: 100, questions_per: 3, needs_llm: true, minutes: 14 }
};

/** 실행 순서 — 값싼 것부터 */
export const MODE_A_SOURCE_ORDER: ModeASourceKind[] = [
  "glossary",
  "image",
  "knowledge",
  "wiki",
  "work",
  "notion"
];

/** 한 크론 청크. 455건을 한 호출에 넣으면 800초에 끊기고 finishRun 이 안 된다. */
export const MODE_A_CALL_BUDGET_MS = 120_000;
/** LLM 원천은 한 청크에 이 문서씩만. 위키를 다 끝내기 전에 Work·노션도 돈다. */
export const MODE_A_LLM_DOCS_PER_CALL: Partial<Record<ModeASourceKind, number>> = {
  wiki: 3,
  work: 2,
  notion: 2
};

function pastDeadline(deadlineMs?: number): boolean {
  return deadlineMs != null && Date.now() > deadlineMs;
}

export const MODE_A_MULTI_MINUTES = MODE_A_SOURCE_ORDER.reduce(
  (s, k) => s + MODE_A_SOURCE_BUDGET[k].minutes,
  0
);

export type ModeASourceResult = {
  source: ModeASourceKind;
  probed: number;
  hit: number;
  miss: number;
  cost_usd: number;
  llm_calls: number;
  duration_ms: number;
  miss_by_cause: Record<string, number>;
  items: ProbeModeAItem[];
  work_miss?: number;
};

export type ModeACorpusResult = {
  mode: "answer_key";
  multi_source: true;
  sources: ModeASourceResult[];
  probed: number;
  hit_at_1: number;
  hit_at_5: number;
  hit_at_10: number;
  miss: number;
  miss_rate: number;
  miss_by_cause: Record<string, number>;
  work_miss: number;
  items: ProbeModeAItem[];
  misses: ProbeModeAItem[];
  learned: string;
  next: string;
  pages_sampled?: number;
  llm_model?: string;
  page_ids?: string[];
};

const HIT_STREAK_KEY = "mode_a_hit_streaks";
const SKIP_AFTER_STREAK = 3;

function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function isMultiSourceModeAEnabled(now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10) >= MODE_A_MULTI_SOURCE_FROM_KST;
}

function bucketForRank(rank: number | null): ProbeHitBucket {
  if (rank == null) return "miss";
  if (rank === 0) return "hit@1";
  if (rank < 5) return "hit@5";
  if (rank < 10) return "hit@10";
  return "miss";
}

function extractPathTokens(path: string): string[] {
  return (
    path
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g)
      ?.filter((t) => !/^(jpg|png|jpeg|gif|webp|ai|psd|pdf)$/i.test(t)) ?? []
  );
}

function extractDescTokens(desc: string): string[] {
  return (
    desc
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g)
      ?.filter((t) => t.length >= 2)
      .slice(0, 24) ?? []
  );
}

async function loadHitStreaks(
  admin: SupabaseClient
): Promise<Record<string, number>> {
  const { data } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", HIT_STREAK_KEY)
    .maybeSingle();
  const v = data?.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, number>;
  }
  return {};
}

async function saveHitStreaks(
  admin: SupabaseClient,
  streaks: Record<string, number>
): Promise<void> {
  await admin.from("luna_settings").upsert({
    key: HIT_STREAK_KEY,
    value: streaks,
    updated_at: new Date().toISOString()
  });
}

function shouldSkipTarget(
  streaks: Record<string, number>,
  targetId: string
): boolean {
  return (streaks[targetId] ?? 0) >= SKIP_AFTER_STREAK;
}

function updateStreak(
  streaks: Record<string, number>,
  targetId: string,
  hit: boolean
): void {
  if (hit) {
    streaks[targetId] = (streaks[targetId] ?? 0) + 1;
  } else {
    streaks[targetId] = 0;
  }
}

/** 용어사전 — 「X가 뭐야?」 → 용어 매칭에 그 항목이 나오나 */
export async function runProbeGlossary(
  admin: SupabaseClient,
  opts?: {
    limit?: number;
    streaks?: Record<string, number>;
    exclude?: Set<string>;
    deadlineMs?: number;
  }
): Promise<ModeASourceResult> {
  const t0 = Date.now();
  const limit = opts?.limit ?? MODE_A_SOURCE_BUDGET.glossary.daily_items;
  const streaks = opts?.streaks ?? {};
  const exclude = opts?.exclude;
  const { data, error } = await admin
    .from("glossary_terms")
    .select("id, term_ko, term_en, synonyms, definition")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(Math.max(limit * 3, 200));
  if (error) throw new Error(error.message);

  const allRows = (data ?? []) as GlossaryMatchRow[];
  const items: ProbeModeAItem[] = [];
  let taken = 0;

  for (const row of allRows) {
    if (taken >= limit || pastDeadline(opts?.deadlineMs)) break;
    const term = (row.term_ko ?? "").trim();
    const id = String(row.id ?? "");
    if (!term || term.length < 2 || !id) continue;
    if (exclude?.has(id)) continue;
    if (shouldSkipTarget(streaks, `glossary:${id}`)) continue;

    const question = `${term}${iGa(term)} 뭐야?`;
    const keywords = [term, ...(Array.isArray(row.synonyms) ? row.synonyms : [])]
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 6);
    const matched = pickGlossaryForQuestion(allRows, keywords, null);
    const rankIdx = matched.findIndex((m) => String(m.id) === id);
    const rank = rankIdx >= 0 ? rankIdx : null;
    const bucket = bucketForRank(rank);
    const top = toTopHits(
      matched.map((m) => ({
        page_id: String(m.id),
        title: (m.term_ko ?? "").slice(0, 120)
      }))
    );

    let cause_kind: MissCauseKind | null = null;
    let cause_guess: string | null = null;
    if (bucket === "miss") {
      // 용어사전에 있는데 못 찾음 → 검색 고장급
      cause_kind = "no_results";
      cause_guess = "용어사전 miss — 항목이 있는데 검색에 안 잡힘";
    }

    items.push({
      page_id: id,
      title: term,
      question,
      rank,
      bucket,
      top,
      cause_guess,
      cause_kind,
      source: "glossary"
    } as ProbeModeAItem & { source: string });

    updateStreak(streaks, `glossary:${id}`, bucket !== "miss");
    taken += 1;
  }

  return summarizeSource("glossary", items, 0, 0, Date.now() - t0);
}

/** 이미지 — 설명 토큰 ⊂ 경로? 규칙 채점 */
export async function runProbeImage(
  admin: SupabaseClient,
  opts?: {
    limit?: number;
    streaks?: Record<string, number>;
    exclude?: Set<string>;
    deadlineMs?: number;
  }
): Promise<ModeASourceResult> {
  const t0 = Date.now();
  const limit = opts?.limit ?? MODE_A_SOURCE_BUDGET.image.daily_items;
  const streaks = opts?.streaks ?? {};
  const exclude = opts?.exclude;
  // 최근 적재는 DSC·원본이 많아 path 순으로 넓게 훑어 한글 라벨 경로를 모은다
  const { data, error } = await admin
    .from("luna_media_index")
    .select("path, description, file_name, project, folder_category, ai_category, purpose")
    .not("description", "is", null)
    .order("path", { ascending: true })
    .limit(2500);
  if (error) throw new Error(error.message);

  const items: ProbeModeAItem[] = [];
  let taken = 0;
  for (const row of data ?? []) {
    if (taken >= limit || pastDeadline(opts?.deadlineMs)) break;
    const path = String(row.path ?? "");
    const desc = String(row.description ?? "").trim();
    if (!path || desc.length < 4) continue;
    if (exclude?.has(path)) continue;
    if (shouldSkipTarget(streaks, `image:${path}`)) continue;
    if (/DSC\d+|IMG_\d+|\\JPEG\\|\\RAW\\|\\원본\\|\\촬영본\\/i.test(path)) {
      continue;
    }

    // 경로·프로젝트·폴더 라벨 토큰 (설명과 맞춰볼 대상)
    const labelBlob = [
      path,
      String(row.project ?? ""),
      String(row.folder_category ?? ""),
      String(row.ai_category ?? ""),
      String(row.purpose ?? "")
    ].join(" ");
    const labelTok = extractPathTokens(labelBlob).filter((t) =>
      /[가-힣]{2,}/.test(t)
    );
    if (labelTok.length === 0) continue;

    const descNorm = desc.toLowerCase();
    // 라벨이 설명에 나오는지 (단청 ∈ 설명 && 단청 ∈ 경로) — 사용자 예시와 동일 방향의 역
    // 설명 핵심어가 라벨에 있는지도 함께 본다
    const labelInDesc = labelTok.filter((t) => descNorm.includes(t));
    const descTok = extractDescTokens(desc)
      .map((t) => t.replace(/(을|를|이|가|은|는|에|의|와|과|로|으로)$/u, ""))
      .filter((t) => t.length >= 2 && /[가-힣]/.test(t));
    const meaningful = descTok.filter(
      (t) =>
        !/^(이미지|사진|화면|배경|디자인|작업|파일|레퍼런스|시안|렌더|샷|공간|실내|어두운|밝은|대형|설치된|천장|벽면|프로젝션|스크린|텍스트|흰색|내부|전시|형태|빛줄기|삼각형|직사각형|중심|선형|물결|가느다란|청록색|보라색|주황색|푸른색|회색|투명한|화사한|햇빛|내리쬐|컬러풀한|입자|조각들|정원|디스플레이|프레임)$/.test(
          t
        )
    );
    const descInLabel = meaningful.filter((t) =>
      labelTok.some((p) => p.includes(t) || t.includes(p))
    );

    // 라벨↔설명 교집합이 있으면 hit. 둘 다 비면 표본 제외(시각 서술만인 경우)
    if (labelInDesc.length === 0 && descInLabel.length === 0) {
      // 시각 서술만 · 라벨도 설명에 없음 → miss (재색인·라벨 보강 후보)
      if (meaningful.length === 0) continue;
    }

    const hit = labelInDesc.length > 0 || descInLabel.length > 0;
    const bucket: ProbeHitBucket = hit ? "hit@1" : "miss";
    const clue = (labelInDesc[0] ?? descInLabel[0] ?? meaningful[0] ?? "").slice(
      0,
      24
    );

    items.push({
      page_id: path,
      title: String(row.file_name ?? path).slice(0, 120),
      question: `설명↔경로 대조 · ${clue}`,
      rank: hit ? 0 : null,
      bucket,
      top: hit
        ? toTopHits([{ page_id: path, title: path.slice(0, 80) }], 1)
        : [],
      cause_guess: hit
        ? null
        : "이미지 설명과 경로·카테고리 불일치 — 재색인 후보",
      cause_kind: hit ? null : "weak_embedding",
      source: "image"
    });

    updateStreak(streaks, `image:${path}`, hit);
    taken += 1;
  }

  return summarizeSource("image", items, 0, 0, Date.now() - t0);
}

/** 아폴론 지식 — 문장 그대로 물어 지식이 매칭되나 */
export async function runProbeKnowledge(
  admin: SupabaseClient,
  opts?: {
    limit?: number;
    streaks?: Record<string, number>;
    exclude?: Set<string>;
    deadlineMs?: number;
  }
): Promise<ModeASourceResult> {
  const t0 = Date.now();
  const limit = opts?.limit ?? MODE_A_SOURCE_BUDGET.knowledge.daily_items;
  const streaks = opts?.streaks ?? {};
  const exclude = opts?.exclude;
  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, category, importance, use_count, created_at")
    .eq("status", "active")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .limit(Math.max(limit * 2, 80));
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as LearningMatchRow[];
  const items: ProbeModeAItem[] = [];
  let taken = 0;
  for (const row of rows) {
    if (taken >= limit || pastDeadline(opts?.deadlineMs)) break;
    const id = String(row.id ?? "");
    const content = String(row.content ?? "").trim();
    if (!id || content.length < 8) continue;
    if (exclude?.has(id)) continue;
    if (shouldSkipTarget(streaks, `knowledge:${id}`)) continue;

    const question = content.slice(0, 80);
    const keywords = question
      .split(/[\s,/|·]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    const picked = pickLearningsForQuestion(rows, keywords, {
      max: 8,
      matchedMax: 8
    });
    const rankIdx = picked.all.findIndex((r) => String(r.id) === id);
    const rank = rankIdx >= 0 ? rankIdx : null;
    const bucket = bucketForRank(rank);

    items.push({
      page_id: id,
      title: content.slice(0, 80),
      question,
      rank,
      bucket,
      top: toTopHits(
        picked.all.map((r) => ({
          page_id: String(r.id),
          title: String(r.content ?? "").slice(0, 80)
        }))
      ),
      cause_guess:
        bucket === "miss" ? "지식 문장이 매칭에 안 잡힘" : null,
      cause_kind: bucket === "miss" ? "other" : null,
      source: "knowledge"
    } as ProbeModeAItem & { source: string });

    updateStreak(streaks, `knowledge:${id}`, bucket !== "miss");
    taken += 1;
  }

  return summarizeSource("knowledge", items, 0, 0, Date.now() - t0);
}

/**
 * Work 선별 기준 (우선순위):
 * 1) nas_important_paths 하위 + 본문 추출 완료
 * 2) 최근 3년 수정(nas_directory.modified_at) + 본문 있음
 * 3) 부족분: 본문 있는 아무 파일(최근 추출 순)
 * 근거: 전량 1.9만은 190일. 중요 경로·최근 프로젝트가 실제 검색 가치.
 */
export async function sampleWorkProbeTargets(
  admin: SupabaseClient,
  limit: number
): Promise<Array<{ path: string; title: string; reason: string }>> {
  const out: Array<{ path: string; title: string; reason: string }> = [];
  const seen = new Set<string>();

  const { data: important } = await admin
    .from("nas_important_paths")
    .select("path")
    .limit(200);
  const prefixes = (important ?? [])
    .map((r) => String(r.path ?? "").trim())
    .filter(Boolean);

  const { data: texts } = await admin
    .from("nas_file_text")
    .select("path, extracted_at")
    .not("extracted_at", "is", null)
    .order("extracted_at", { ascending: false })
    .limit(8000);

  const threeYearsAgo = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;

  for (const row of texts ?? []) {
    if (out.length >= limit) break;
    const path = String(row.path ?? "");
    if (!path || seen.has(path)) continue;
    const underImportant = prefixes.some(
      (p) => path === p || path.startsWith(p + "\\") || path.startsWith(p + "/")
    );
    if (!underImportant) continue;
    seen.add(path);
    out.push({
      path,
      title: path.split(/[/\\]/).pop() ?? path,
      reason: "important_path"
    });
  }

  if (out.length < limit) {
    const { data: recent } = await admin
      .from("nas_directory")
      .select("path, modified_at")
      .not("modified_at", "is", null)
      .gte("modified_at", new Date(threeYearsAgo).toISOString())
      .order("modified_at", { ascending: false })
      .limit(4000);
    const textSet = new Set((texts ?? []).map((t) => String(t.path)));
    for (const row of recent ?? []) {
      if (out.length >= limit) break;
      const path = String(row.path ?? "");
      if (!path || seen.has(path) || !textSet.has(path)) continue;
      seen.add(path);
      out.push({
        path,
        title: path.split(/[/\\]/).pop() ?? path,
        reason: "recent_3y"
      });
    }
  }

  if (out.length < limit) {
    for (const row of texts ?? []) {
      if (out.length >= limit) break;
      const path = String(row.path ?? "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({
        path,
        title: path.split(/[/\\]/).pop() ?? path,
        reason: "extracted_fill"
      });
    }
  }

  return out;
}

/** Work 본문 — 질문 LLM은 호출측에서 주입하거나 제목 기반 간이 질문 */
export async function runProbeWork(
  admin: SupabaseClient,
  opts: {
    limit?: number;
    streaks?: Record<string, number>;
    generateQuestions: (title: string, body: string) => Promise<{
      questions: string[];
      cost_usd: number;
      llm_calls: number;
    }>;
    exclude?: Set<string>;
    deadlineMs?: number;
  }
): Promise<ModeASourceResult> {
  const t0 = Date.now();
  const limit = opts.limit ?? MODE_A_SOURCE_BUDGET.work.daily_items;
  const streaks = opts.streaks ?? {};
  const targets = await sampleWorkProbeTargets(
    admin,
    Math.min(400, Math.max(limit * 4, limit + (opts.exclude?.size ?? 0)))
  );
  const items: ProbeModeAItem[] = [];
  let cost = 0;
  let llmCalls = 0;
  let taken = 0;

  for (const target of targets) {
    if (taken >= limit || pastDeadline(opts.deadlineMs)) break;
    if (opts.exclude?.has(target.path)) continue;
    if (shouldSkipTarget(streaks, `work:${target.path}`)) continue;

    const { data: chunks } = await admin
      .from("nas_file_chunks")
      .select("content")
      .eq("path", target.path)
      .order("seq", { ascending: true })
      .limit(8);
    const body = (chunks ?? [])
      .map((c) => String(c.content ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 2800);
    if (body.length < 40) continue;

    let questions: string[] = [];
    try {
      const gen = await opts.generateQuestions(target.title, body);
      questions = gen.questions.slice(0, MODE_A_QUESTIONS_PER_PAGE);
      cost += gen.cost_usd;
      llmCalls += gen.llm_calls;
    } catch (err) {
      console.error("[probe-mode-a] work qgen", target.path, err);
      continue;
    }
    if (questions.length === 0) continue;

    let anyHit = false;
    for (const question of questions) {
      const hits = await searchNasTextKeyword(admin, question, {
        limit: MODE_A_TOP_STORE
      });
      const rankIdx = hits.findIndex((h) => h.path === target.path);
      const rank = rankIdx >= 0 ? rankIdx : null;
      const bucket = bucketForRank(rank);
      if (bucket !== "miss") anyHit = true;

      let cause_kind: MissCauseKind | null = null;
      let cause_guess: string | null = null;
      if (bucket === "miss") {
        cause_kind = "weak_embedding";
        cause_guess = "Work miss — trigram 순위 나쁨(임베딩 필요 증거)";
      }

      items.push({
        page_id: target.path,
        title: target.title,
        question,
        rank,
        bucket,
        top: toTopHits(
          hits.map((h) => ({
            page_id: h.path,
            title: (h.path.split(/[/\\]/).pop() ?? h.path).slice(0, 120),
            score: typeof h.score === "number" ? h.score : null
          }))
        ),
        cause_guess,
        cause_kind,
        source: "work"
      } as ProbeModeAItem & { source: string });
    }
    updateStreak(streaks, `work:${target.path}`, anyHit);
    taken += 1;
  }

  const result = summarizeSource("work", items, cost, llmCalls, Date.now() - t0);
  result.work_miss = items.filter((i) => i.bucket === "miss").length;
  return result;
}

export async function runProbeWiki(
  admin: SupabaseClient,
  opts: {
    limit?: number;
    streaks?: Record<string, number>;
    generateQuestions: (title: string, body: string) => Promise<{
      questions: string[];
      cost_usd: number;
      llm_calls: number;
    }>;
    exclude?: Set<string>;
    deadlineMs?: number;
  }
): Promise<ModeASourceResult> {
  const t0 = Date.now();
  const limit = opts.limit ?? MODE_A_SOURCE_BUDGET.wiki.daily_items;
  const streaks = opts.streaks ?? {};
  const { items: docs } = await loadWikiDocs(admin, { activeOnly: true });
  const items: ProbeModeAItem[] = [];
  let cost = 0;
  let llmCalls = 0;
  let taken = 0;

  for (const doc of docs) {
    if (taken >= limit || pastDeadline(opts.deadlineMs)) break;
    const slug = doc.slug;
    if (!slug || opts.exclude?.has(slug) || shouldSkipTarget(streaks, `wiki:${slug}`)) {
      continue;
    }
    const body = `${doc.summary ?? ""}\n${doc.content ?? ""}`.slice(0, 2800);
    if (body.trim().length < 20) continue;

    let questions: string[] = [];
    try {
      const gen = await opts.generateQuestions(doc.title || slug, body);
      questions = gen.questions.slice(0, MODE_A_QUESTIONS_PER_PAGE);
      cost += gen.cost_usd;
      llmCalls += gen.llm_calls;
    } catch (err) {
      console.error("[probe-mode-a] wiki qgen", slug, err);
      continue;
    }
    if (questions.length === 0) continue;

    let anyHit = false;
    for (const question of questions) {
      const keywords = question
        .split(/[\s,/|]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
        .slice(0, 8);
      const matched = matchWikiSections(docs, keywords, question, [], {
        sectionMax: MODE_A_TOP_STORE,
        sectionsPerDocMax: 2
      });
      const rankIdx = matched.findIndex((m) => m.slug === slug);
      const rank = rankIdx >= 0 ? rankIdx : null;
      const bucket = bucketForRank(rank);
      if (bucket !== "miss") anyHit = true;

      items.push({
        page_id: slug,
        title: doc.title || slug,
        question,
        rank,
        bucket,
        top: toTopHits(
          matched.map((m) => ({
            page_id: m.slug,
            title: (m.title || m.slug).slice(0, 120)
          }))
        ),
        cause_guess: bucket === "miss" ? "위키 miss" : null,
        cause_kind: bucket === "miss" ? "other" : null,
        source: "wiki"
      });
    }
    updateStreak(streaks, `wiki:${slug}`, anyHit);
    taken += 1;
  }

  return summarizeSource("wiki", items, cost, llmCalls, Date.now() - t0);
}

function summarizeSource(
  source: ModeASourceKind,
  items: ProbeModeAItem[],
  cost_usd: number,
  llm_calls: number,
  duration_ms: number
): ModeASourceResult {
  const miss_by_cause: Record<string, number> = {};
  for (const m of items) {
    if (m.bucket !== "miss" || !m.cause_kind) continue;
    miss_by_cause[m.cause_kind] = (miss_by_cause[m.cause_kind] ?? 0) + 1;
  }
  return {
    source,
    probed: items.length,
    hit: items.filter((i) => i.bucket !== "miss").length,
    miss: items.filter((i) => i.bucket === "miss").length,
    cost_usd: Number(cost_usd.toFixed(6)),
    llm_calls,
    duration_ms,
    miss_by_cause,
    items
  };
}

/** miss≥3 동일 원인 → 규칙 후보 */
export async function promoteMissCausesToRules(
  admin: SupabaseClient,
  missByCause: Record<string, number>
): Promise<string[]> {
  const promoted: string[] = [];
  for (const [kind, count] of Object.entries(missByCause)) {
    if (count < 3) continue;
    const label = MISS_CAUSE_LABEL[kind as MissCauseKind] ?? kind;
    const pattern_value = `mode_a_miss:${kind}`;
    const { data: existing } = await admin
      .from("luna_rules")
      .select("id, status")
      .eq("scope", "search")
      .eq("pattern_type", "rule")
      .eq("pattern_value", pattern_value)
      .maybeSingle();
    if (existing?.status === "active") continue;
    if (existing?.id) {
      await admin
        .from("luna_rules")
        .update({
          status: "candidate",
          signal_count: count,
          evidence: { miss_cause: kind, count, label },
          confirmed_at: null
        })
        .eq("id", existing.id);
    } else {
      const { error } = await admin.from("luna_rules").insert({
        scope: "search",
        pattern_type: "rule",
        pattern_value,
        signal_count: count,
        evidence: { miss_cause: kind, count, label },
        status: "candidate"
      });
      if (error) {
        console.error("[probe-mode-a] rule insert", error);
        continue;
      }
    }
    promoted.push(kind);
  }
  return promoted;
}

export async function runModeAMultiSource(
  admin: SupabaseClient,
  opts: {
    limits?: Partial<Record<ModeASourceKind, number>>;
    /** 시험용: 일부 원천만 */
    only?: ModeASourceKind[];
    budgetMs?: number;
    /** LLM 원천 한 청크당 문서 수. 없으면 원천별 기본값 */
    llmChunk?: number;
    exclude?: Set<string>;
    generateQuestions: (title: string, body: string) => Promise<{
      questions: string[];
      cost_usd: number;
      llm_calls: number;
    }>;
    runNotion: (
      pageLimit: number,
      budgetMs: number
    ) => Promise<{
      result: {
        probed: number;
        hit_at_1?: number;
        hit_at_5?: number;
        hit_at_10?: number;
        miss?: number;
        miss_by_cause?: Record<string, number>;
        items?: ProbeModeAItem[];
      };
      cost_usd: number;
      llm_calls: number;
    }>;
  }
): Promise<{
  result: ModeACorpusResult;
  cost_usd: number;
  llm_calls: number;
}> {
  const streaks = await loadHitStreaks(admin);
  const order = opts.only ?? MODE_A_SOURCE_ORDER;
  const sources: ModeASourceResult[] = [];
  let cost = 0;
  let llmCalls = 0;
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? MODE_A_CALL_BUDGET_MS);
  const exclude = opts.exclude ?? new Set<string>();
  console.log("[mode-a] chunk start", {
    exclude: exclude.size,
    budget_ms: deadline - started
  });

  for (const kind of order) {
    if (pastDeadline(deadline)) {
      console.log("[mode-a] budget stop before", kind);
      break;
    }
    const daily =
      opts.limits?.[kind] ?? MODE_A_SOURCE_BUDGET[kind].daily_items;
    const share = MODE_A_LLM_DOCS_PER_CALL[kind] ?? 2;
    const lim = MODE_A_SOURCE_BUDGET[kind].needs_llm
      ? Math.min(daily, opts.llmChunk ?? share)
      : daily;
    if (lim <= 0) continue;
    const common = { limit: lim, streaks, exclude, deadlineMs: deadline };
    if (kind === "glossary") {
      sources.push(await runProbeGlossary(admin, common));
    } else if (kind === "image") {
      sources.push(await runProbeImage(admin, common));
    } else if (kind === "knowledge") {
      sources.push(await runProbeKnowledge(admin, common));
    } else if (kind === "wiki") {
      const s = await runProbeWiki(admin, {
        ...common,
        generateQuestions: opts.generateQuestions
      });
      sources.push(s);
      cost += s.cost_usd;
      llmCalls += s.llm_calls;
    } else if (kind === "work") {
      const s = await runProbeWork(admin, {
        ...common,
        generateQuestions: opts.generateQuestions
      });
      sources.push(s);
      cost += s.cost_usd;
      llmCalls += s.llm_calls;
    } else if (kind === "notion") {
      const t0 = Date.now();
      const out = await opts.runNotion(
        lim,
        Math.max(5_000, deadline - Date.now())
      );
      const items = out.result.items ?? [];
      const miss_by_cause = out.result.miss_by_cause ?? {};
      sources.push({
        source: "notion",
        probed: out.result.probed,
        hit: (out.result.probed ?? 0) - (out.result.miss ?? 0),
        miss: out.result.miss ?? 0,
        cost_usd: out.cost_usd,
        llm_calls: out.llm_calls,
        duration_ms: Date.now() - t0,
        miss_by_cause,
        items
      });
      cost += out.cost_usd;
      llmCalls += out.llm_calls;
    }
    const last = sources[sources.length - 1];
    if (last) {
      console.log("[mode-a] source", {
        source: last.source,
        probed: last.probed,
        llm: last.llm_calls,
        ms: last.duration_ms
      });
    }
  }

  await saveHitStreaks(admin, streaks);

  const allItems = sources.flatMap((s) => s.items);
  const miss_by_cause: Record<string, number> = {};
  for (const s of sources) {
    for (const [k, v] of Object.entries(s.miss_by_cause)) {
      miss_by_cause[k] = (miss_by_cause[k] ?? 0) + v;
    }
  }
  const work_miss = sources
    .filter((s) => s.source === "work")
    .reduce((a, s) => a + (s.work_miss ?? s.miss), 0);

  await promoteMissCausesToRules(admin, miss_by_cause);

  const probed = allItems.length;
  const miss = allItems.filter((i) => i.bucket === "miss").length;
  const hit_at_1 = allItems.filter((i) => i.rank === 0).length;
  const hit_at_5 = allItems.filter((i) => i.rank != null && i.rank < 5).length;
  const hit_at_10 = allItems.filter((i) => i.rank != null && i.rank < 10).length;

  const bySrc = sources
    .map((s) => `${s.source} ${s.hit}/${s.probed}`)
    .join(" · ");

  return {
    result: {
      mode: "answer_key",
      multi_source: true,
      sources,
      probed,
      hit_at_1,
      hit_at_5,
      hit_at_10,
      miss,
      miss_rate: probed > 0 ? miss / probed : 0,
      miss_by_cause,
      work_miss,
      items: allItems.slice(0, 80),
      misses: allItems.filter((i) => i.bucket === "miss").slice(0, 40),
      learned: `원천별 검증 ${bySrc}. Work miss ${work_miss}건(임베딩 근거).`,
      next:
        miss > 0
          ? "miss 원인별 후속 아젠다 · 3건↑ 규칙 후보"
          : "연속 hit 대상은 주기 연장(3회↑)",
      page_ids: [...new Set(allItems.map((i) => i.page_id).filter(Boolean))]
    },
    cost_usd: Number(cost.toFixed(6)),
    llm_calls: llmCalls
  };
}

void todayKst;
