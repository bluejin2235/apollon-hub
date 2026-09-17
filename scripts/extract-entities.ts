/**
 * 노션 본문·위키에서 고유명사 후보 추출 (규칙 우선, LLM은 분류만).
 * 자동 등록 없음 — dry-run 보고용.
 *
 *   npx tsx scripts/extract-entities.ts --dry-run --limit=200
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { anthropicApiKey } from "@/lib/luna/env-keys";
import { resolveOfficialPrice } from "@/lib/luna/model-pricing";

type EntityKind = "프로그램명" | "업체" | "장소" | "기술" | "그 밖";
type RuleId = "english_proper" | "quoted" | "suffix" | "repeat";
type Bucket = "auto" | "knowledge" | "discard";

type SourceDoc = {
  id: string;
  source: "notion_block" | "wiki";
  text: string;
  pageTitleBlob: string;
};

type RawHit = {
  term: string;
  rule: RuleId;
  sourceId: string;
};

type Candidate = {
  term: string;
  count: number;
  rules: RuleId[];
  sources: string[];
  bucket: Bucket;
  kind: EntityKind | null;
  examples: string[];
};

const MODEL = "claude-haiku-4-5";
/** 접미사 직전 1~2어절만 (문장 통째로 잡지 않음) */
const SUFFIX_RE =
  /([가-힣A-Za-z0-9][가-힣A-Za-z0-9·&\-]{1,16}(?:\s+[가-힣A-Za-z0-9][가-힣A-Za-z0-9·&\-]{1,16})?)\s*(스튜디오|시스템|랩|연구소|파트너스|커뮤니케이션|프로덕션|에이전시)\b/g;

const ENGLISH_STRICT_RE =
  /\b([A-Z][a-z0-9]*(?:\s+[A-Z][a-z0-9]*)+)\b/g;

const QUOTED_RE =
  /[「『<〈《]([^」』>〉》\n]{2,24})[」』>〉》]/g;

const HANGUL_TOKEN_RE = /[가-힣]{2,12}/g;

const EN_STOP = new Set(
  [
    "The",
    "This",
    "That",
    "These",
    "Those",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Project",
    "Design",
    "Studio",
    "System",
    "Team",
    "Meeting",
    "Document",
    "Version",
    "Update",
    "Status",
    "Notion",
    "Google",
    "Microsoft",
    "Windows",
    "Office",
    "Power",
    "Point",
    "Page",
    "File",
    "Folder",
    "Image",
    "Video",
    "Audio",
    "Link",
    "Note",
    "Todo",
    "Done",
    "Draft",
    "Final",
    "Review",
    "Comment",
    "Apollon",
    "Luna"
  ].map((s) => s.toLowerCase())
);

const KO_STOP = new Set([
  "그리고",
  "하지만",
  "그래서",
  "오늘",
  "내일",
  "어제",
  "이번",
  "다음",
  "지난",
  "관련",
  "내용",
  "자료",
  "일정",
  "회의",
  "미팅",
  "프로젝트",
  "진행",
  "확인",
  "요청",
  "전달",
  "공유",
  "검토",
  "수정",
  "업데이트",
  "버전",
  "파일",
  "폴더",
  "이미지",
  "영상",
  "문서",
  "페이지",
  "노션",
  "위키",
  "아폴론",
  "루나",
  "리더방",
  "통합캘린더",
  "사람",
  "인원",
  "전체",
  "부분",
  "기본",
  "설정",
  "관리",
  "정보",
  "자료들",
  "내부",
  "외부",
  "작업",
  "제작",
  "디자인",
  "콘텐츠",
  "미디어",
  "공간",
  "제안",
  "제안서",
  "보고서",
  "기획",
  "개발",
  "사업",
  "단계",
  "방법",
  "회사",
  "가능",
  "기준",
  "사용",
  "이후",
  "리뉴얼",
  "면세점",
  "로그인",
  "서버",
  "데이터",
  "인증",
  "사내",
  "사무실",
  "윈도우",
  "머신",
  "부스",
  "쇼핑몰",
  "원격",
  "입구",
  "필터",
  "호텔",
  "터널",
  "워크",
  "인터랙티브",
  "아키텍쳐",
  "아키텍처",
  "모델하우스",
  "하드웨어",
  "비밀번호",
  "레퍼런스",
  "프로세스",
  "크리에이티브",
  "제안단계",
  "공공부지사업",
  "대표이사",
  "프로그램"
]);

/** 조사·어미·활용형 — 반복 한글 후보에서 제외 */
const KO_MORPH_TAIL =
  /(으로|에서|에게|한테|까지|부터|처럼|통해|도록|면서|하며|하고|하는|한다|되는|된다|있는|있다|없는|없다|하지|되어|되어|해서|해서|이며|이고|이나|또는|및|등|의|을|를|이|가|은|는|과|와|도|만|께)$/;

function parseArgs(argv: string[]) {
  let dryRun = false;
  let limit = 200;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--limit=")) {
      const n = parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { dryRun, limit };
}

function createAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function normKey(term: string): string {
  return term.replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanTerm(raw: string): string | null {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s·,./:;|+\-–—]+|[\s·,./:;|+\-–—]+$/g, "");
  if (t.length < 2 || t.length > 40) return null;
  if (/^\d+$/.test(t)) return null;
  if (/^https?:/i.test(t)) return null;
  if (EN_STOP.has(t.toLowerCase())) return null;
  if (KO_STOP.has(t)) return null;
  // 조사만 남은 짧은 한글 제외
  if (/^[가-힣]{1}$/.test(t)) return null;
  return t;
}

function isInGlossary(term: string, glossary: Set<string>): boolean {
  return glossary.has(normKey(term));
}

function looksLikeKoreanProper(term: string): boolean {
  if (!/^[가-힣]{2,16}$/.test(term)) return false;
  if (KO_STOP.has(term)) return false;
  if (KO_MORPH_TAIL.test(term)) return false;
  // 장소·브랜드성 접미 또는 3자 이상 고유명사형
  if (
    /(로|리|동|구|역|타워|호텔|스퀘어|빌딩|센터|플라자|파크|몰|존|룸|스튜디오|시스템|랩)$/.test(
      term
    )
  ) {
    return term.length >= 3;
  }
  return term.length >= 4;
}

function isInProjectTitles(term: string, titleBlob: string): boolean {
  if (!titleBlob) return false;
  const blob = titleBlob.toLowerCase();
  const k = normKey(term);
  return blob.includes(k);
}

function extractFromText(
  text: string,
  sourceId: string,
  pageTitleBlob: string
): RawHit[] {
  const hits: RawHit[] = [];
  const push = (raw: string, rule: RuleId) => {
    const term = cleanTerm(raw);
    if (!term) return;
    if (isInProjectTitles(term, pageTitleBlob)) return;
    hits.push({ term, rule, sourceId });
  };

  for (const m of text.matchAll(QUOTED_RE)) {
    const q = (m[1] ?? "").trim();
    // 긴 설명문·문장 인용 제외
    if (q.length > 24) continue;
    if (/[.!?。]/.test(q)) continue;
    if (KO_MORPH_TAIL.test(q)) continue;
    if ((q.match(/\s/g) ?? []).length >= 3) continue;
    push(q, "quoted");
  }

  SUFFIX_RE.lastIndex = 0;
  for (const m of text.matchAll(SUFFIX_RE)) {
    const head = (m[1] ?? "").trim();
    const suf = (m[2] ?? "").trim();
    if (!head || !suf) continue;
    // 조사·서술 조각이 섞인 긴 head 버림
    if (head.length > 24 || /\s/.test(head) && head.split(/\s+/).length > 2) {
      continue;
    }
    if (KO_MORPH_TAIL.test(head) || /^(을|를|이|가|은|는|의|과|와)/.test(head)) {
      continue;
    }
    push(`${head} ${suf}`, "suffix");
  }

  ENGLISH_STRICT_RE.lastIndex = 0;
  for (const m of text.matchAll(ENGLISH_STRICT_RE)) {
    push(m[1] ?? "", "english_proper");
  }
  // 단일 토큰 기술명 (D5 등)
  for (const m of text.matchAll(/\b(D5|Enscape|Cinema\s*4D|Unreal|Unity)\b/gi)) {
    push(m[1] ?? "", "english_proper");
  }

  return hits;
}

/** 본문 반복 한글 고유명사형 — 프로젝트명에 없고 3회+ */
function extractRepeatHangul(
  docs: SourceDoc[],
  glossary: Set<string>
): RawHit[] {
  const counts = new Map<
    string,
    { term: string; n: number; sources: Set<string> }
  >();
  for (const doc of docs) {
    const seenInDoc = new Set<string>();
    for (const m of doc.text.matchAll(HANGUL_TOKEN_RE)) {
      const term = cleanTerm(m[0] ?? "");
      if (!term) continue;
      if (!looksLikeKoreanProper(term)) continue;
      if (isInGlossary(term, glossary)) continue;
      if (isInProjectTitles(term, doc.pageTitleBlob)) continue;
      const k = normKey(term);
      if (seenInDoc.has(k)) continue;
      seenInDoc.add(k);
      const cur = counts.get(k) ?? { term, n: 0, sources: new Set() };
      cur.n += 1;
      cur.sources.add(doc.id);
      counts.set(k, cur);
    }
  }
  const hits: RawHit[] = [];
  for (const row of counts.values()) {
    if (row.n < 3) continue;
    for (const sid of row.sources) {
      hits.push({ term: row.term, rule: "repeat", sourceId: sid });
    }
  }
  return hits;
}

function bucketOf(count: number, rules: RuleId[]): Bucket {
  const strong = rules.some((r) => r !== "repeat") || rules.includes("repeat");
  if (count >= 3 && strong) return "auto";
  if (count >= 1 && count <= 2 && rules.length > 0) return "knowledge";
  if (count === 1 && rules.length === 0) return "discard";
  // repeat-only with 3+ already auto; 1-2 with only weak → knowledge if any rule
  if (count >= 3) return "auto";
  return "discard";
}

async function loadGlossary(admin: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("glossary_terms")
      .select("term_ko, term_en, synonyms")
      .is("deleted_at", null)
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      if (typeof r.term_ko === "string" && r.term_ko.trim()) {
        out.add(normKey(r.term_ko));
      }
      if (typeof r.term_en === "string" && r.term_en.trim()) {
        out.add(normKey(r.term_en));
      }
      if (Array.isArray(r.synonyms)) {
        for (const s of r.synonyms) {
          if (typeof s === "string" && s.trim()) out.add(normKey(s));
        }
      }
    }
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

async function loadPageTitleMap(
  admin: SupabaseClient
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select("page_id, title, root_title, path_titles")
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const parts = [
        typeof r.title === "string" ? r.title : "",
        typeof r.root_title === "string" ? r.root_title : "",
        Array.isArray(r.path_titles)
          ? r.path_titles.filter((x): x is string => typeof x === "string").join(" ")
          : ""
      ];
      map.set(String(r.page_id), parts.join(" ").toLowerCase());
    }
    if (rows.length < page) break;
    from += page;
  }
  return map;
}

async function loadDocs(
  admin: SupabaseClient,
  limit: number,
  titleMap: Map<string, string>
): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];

  // 위키 먼저 (소수)
  const { data: wikiRows, error: wikiErr } = await admin
    .from("luna_library")
    .select("id, title, content, summary")
    .eq("is_active", true);
  if (wikiErr) throw wikiErr;
  for (const r of wikiRows ?? []) {
    const text = [r.title, r.summary, r.content]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");
    if (text.trim().length < 20) continue;
    docs.push({
      id: `wiki:${r.id}`,
      source: "wiki",
      text,
      pageTitleBlob: typeof r.title === "string" ? r.title.toLowerCase() : ""
    });
  }

  const remain = Math.max(0, limit - docs.length);
  if (remain > 0) {
    const { data: blocks, error: blockErr } = await admin
      .from("luna_notion_blocks")
      .select("block_id, page_id, text")
      .not("text", "is", null)
      .order("position", { ascending: true })
      .limit(remain * 3);
    if (blockErr) throw blockErr;
    for (const b of blocks ?? []) {
      if (docs.length >= limit) break;
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (text.length < 20) continue;
      const pageId = String(b.page_id ?? "");
      docs.push({
        id: `block:${b.block_id}`,
        source: "notion_block",
        text,
        pageTitleBlob: titleMap.get(pageId) ?? ""
      });
    }
  }

  return docs.slice(0, limit);
}

async function classifyWithLlm(
  terms: string[]
): Promise<{
  kinds: Map<string, EntityKind>;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const kinds = new Map<string, EntityKind>();
  if (terms.length === 0) {
    return { kinds, calls: 0, inputTokens: 0, outputTokens: 0 };
  }
  const key = anthropicApiKey();
  if (!key) {
    console.warn("[extract-entities] no Anthropic key — skip LLM classify");
    return { kinds, calls: 0, inputTokens: 0, outputTokens: 0 };
  }
  const client = new Anthropic({ apiKey: key });
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const batchSize = 40;
  for (let i = 0; i < terms.length; i += batchSize) {
    const batch = terms.slice(i, i + batchSize);
    const prompt = `다음 고유명사 후보를 하나씩 분류하라. JSON 배열만 답한다.
각 원소: {"term":"...","kind":"프로그램명"|"업체"|"장소"|"기술"|"그 밖"}
사람 이름·일반 명사·날짜·조사·불명확은 "그 밖".

후보:
${batch.map((t, n) => `${n + 1}. ${t}`).join("\n")}`;
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }]
    });
    calls += 1;
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;
    const text =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        term?: string;
        kind?: string;
      }>;
      for (const row of parsed) {
        if (!row?.term || !row?.kind) continue;
        const kind = row.kind as EntityKind;
        if (
          kind === "프로그램명" ||
          kind === "업체" ||
          kind === "장소" ||
          kind === "기술" ||
          kind === "그 밖"
        ) {
          kinds.set(normKey(row.term), kind);
        }
      }
    } catch {
      console.warn("[extract-entities] LLM JSON parse fail", text.slice(0, 200));
    }
  }
  return { kinds, calls, inputTokens, outputTokens };
}

function exampleSnippet(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + term.length + 40);
  return text.slice(start, end).replace(/\s+/g, " ");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun) {
    console.log("등록은 하지 않습니다. --dry-run 으로 후보만 뽑습니다.");
  }
  const admin = createAdmin();
  console.log(`limit=${opts.limit} dry-run=${opts.dryRun}`);

  const glossary = await loadGlossary(admin);
  console.log(`glossary exclude: ${glossary.size}`);

  const titleMap = await loadPageTitleMap(admin);
  console.log(`notion pages (titles): ${titleMap.size}`);

  const docs = await loadDocs(admin, opts.limit, titleMap);
  const bySource = {
    notion_block: docs.filter((d) => d.source === "notion_block").length,
    wiki: docs.filter((d) => d.source === "wiki").length
  };
  console.log(
    `docs: ${docs.length} (notion_block=${bySource.notion_block}, wiki=${bySource.wiki})`
  );

  const raw: RawHit[] = [];
  for (const doc of docs) {
    raw.push(...extractFromText(doc.text, doc.id, doc.pageTitleBlob));
  }
  raw.push(...extractRepeatHangul(docs, glossary));

  type Agg = {
    term: string;
    rules: Set<RuleId>;
    sources: Set<string>;
    count: number;
  };
  const agg = new Map<string, Agg>();
  for (const hit of raw) {
    if (isInGlossary(hit.term, glossary)) continue;
    const k = normKey(hit.term);
    const cur = agg.get(k) ?? {
      term: hit.term,
      rules: new Set<RuleId>(),
      sources: new Set<string>(),
      count: 0
    };
    // prefer longer / better casing display
    if (hit.term.length > cur.term.length) cur.term = hit.term;
    cur.rules.add(hit.rule);
    cur.sources.add(hit.sourceId);
    cur.count += 1;
    agg.set(k, cur);
  }

  // recount occurrence across docs (unique per doc) for confidence
  for (const [k, cur] of agg) {
    let docHits = 0;
    for (const doc of docs) {
      if (doc.text.toLowerCase().includes(k)) docHits += 1;
    }
    // use max of rule-hit count and doc occurrence
    cur.count = Math.max(cur.count, docHits, cur.sources.size);
    agg.set(k, cur);
  }

  const candidates: Candidate[] = [];
  for (const cur of agg.values()) {
    const rules = [...cur.rules];
    const bucket = bucketOf(cur.count, rules);
    if (bucket === "discard") continue;
    const examples: string[] = [];
    for (const doc of docs) {
      if (examples.length >= 2) break;
      if (doc.text.toLowerCase().includes(normKey(cur.term))) {
        examples.push(exampleSnippet(doc.text, cur.term));
      }
    }
    candidates.push({
      term: cur.term,
      count: cur.count,
      rules,
      sources: [...cur.sources].slice(0, 8),
      bucket,
      kind: null,
      examples
    });
  }

  candidates.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

  // LLM 은 강한 규칙·고유명사형만 (조사 쓰레기 절감)
  const toClassify = candidates
    .filter((c) => {
      if (c.bucket === "discard") return false;
      const strong = c.rules.some((r) => r !== "repeat");
      if (strong) return true;
      return looksLikeKoreanProper(c.term);
    })
    .map((c) => c.term);
  const llm = await classifyWithLlm(toClassify);
  for (const c of candidates) {
    c.kind = llm.kinds.get(normKey(c.term)) ?? null;
  }

  // 「그 밖」·미분류는 보고용 고유명사에서 제외 (오탐 후보로만)
  const entities = candidates.filter(
    (c) =>
      c.kind === "프로그램명" ||
      c.kind === "업체" ||
      c.kind === "장소" ||
      c.kind === "기술"
  );
  const otherOrUnknown = candidates.filter(
    (c) =>
      !c.kind ||
      c.kind === "그 밖"
  );

  const price = resolveOfficialPrice(MODEL);
  const costUsd = price
    ? (llm.inputTokens / 1_000_000) * price.input +
      (llm.outputTokens / 1_000_000) * price.output
    : 0;

  const byKind: Record<string, number> = {};
  for (const c of entities) {
    const k = c.kind ?? "미분류";
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const byBucket: Record<string, number> = {};
  for (const c of entities) {
    byBucket[c.bucket] = (byBucket[c.bucket] ?? 0) + 1;
  }

  const top30 = entities.slice(0, 30);
  const falsePositives = [
    ...otherOrUnknown.filter((c) => c.count >= 3).slice(0, 15),
    ...entities.filter((c) => {
      // 일반 명사로 보이는 짧은 한글·일반어
      if (KO_STOP.has(c.term)) return true;
      if (
        /^[가-힣]{2,3}$/.test(c.term) &&
        !/(로|리|동|구|역|존|룸)$/.test(c.term)
      ) {
        return true;
      }
      return false;
    })
  ];

  console.log("\n=== extract-entities dry-run ===");
  console.log(`sources: ${docs.length}`);
  console.log(`raw_candidates: ${candidates.length}`);
  console.log(`entities (분류 확정): ${entities.length}`);
  console.log(`by_bucket: ${JSON.stringify(byBucket)}`);
  console.log(`by_kind: ${JSON.stringify(byKind)}`);
  console.log(
    `llm: calls=${llm.calls} in=${llm.inputTokens} out=${llm.outputTokens} cost=$${costUsd.toFixed(4)}`
  );
  console.log("\n--- top 30 ---");
  for (const [i, c] of top30.entries()) {
    console.log(
      `${String(i + 1).padStart(2)}. [${c.bucket}] [${c.kind ?? "?"}] ×${c.count}  ${c.term}  (${c.rules.join("+")})`
    );
  }
  console.log("\n--- likely false positives (sample) ---");
  for (const c of falsePositives.slice(0, 20)) {
    console.log(
      `  · ${c.term}  kind=${c.kind ?? "?"} count=${c.count} rules=${c.rules.join("+")}`
    );
  }

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const outPath = resolve(process.cwd(), "tmp", "extract-entities-dry-run.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        limit: opts.limit,
        docs: docs.length,
        by_source: bySource,
        glossary_excluded: glossary.size,
        raw_candidate_count: candidates.length,
        entity_count: entities.length,
        by_bucket: byBucket,
        by_kind: byKind,
        llm: {
          calls: llm.calls,
          input_tokens: llm.inputTokens,
          output_tokens: llm.outputTokens,
          cost_usd: costUsd,
          model: MODEL
        },
        top30,
        false_positives_sample: falsePositives.slice(0, 40),
        entities,
        discarded_as_other: otherOrUnknown.slice(0, 100)
      },
      null,
      2
    )
  );
  console.log(`\nJSON: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
