import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCandidate,
  makeTurn,
  parseJsonArray,
  parseJsonObject
} from "@/lib/luna/candidates";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import { lunaNotify } from "@/lib/luna/notify";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import { runLunaTurn } from "@/lib/luna/run-chat";

// ── Legacy types (채팅 리포트 매칭·trace 탭 호환) ─────────────────

export type SelfstudySource = "frequency" | "failure" | "manual" | "project";
export type SelfstudyQueueStatus = "pending" | "running" | "done" | "skipped";

export type SelfstudyQueueRow = {
  id: string;
  topic: string;
  source: SelfstudySource;
  score: number;
  evidence: Record<string, unknown>;
  status: SelfstudyQueueStatus;
  project_id: string | null;
  created_at: string;
  processed_at: string | null;
};

export type LunaReportRow = {
  id: string;
  topic: string;
  title: string;
  content: string;
  sources: unknown;
  queue_id: string | null;
  project_id: string | null;
  use_count: number;
  last_used_at: string | null;
  status: string;
  model_label: string | null;
  created_at: string;
};

const REPORT_SIM_THRESHOLD = 0.35;
const SETTINGS_KEY = "selfstudy_last_run";
const MAX_PER_DAY = 3;

const SELFSTUDY_FALLBACK = `오늘 대화 기록에서 "내가 막혔던 순간"만 찾는다:
- 검색했지만 0건이었던 주제
- 되물었지만 해소되지 않은 것
- 사람에게 정정받은 것 중 아직 이해가 얕은 것

각각에 대해 스스로 질문을 만든다 (오늘 실제로 막힌 것에서만. 임의 주제 선정 금지).
하루 최대 3문답. 막힌 것이 없었으면 빈 배열.

JSON 배열만:
[{ "question": "스스로 던질 질문", "topic": "막힌 주제 짧은 이름", "conversation_id": "...", "user_id": "...", "user_name": "..." }]`;

const CORRECTION_RE = /아니라|그게 아니고|그게 아니라|틀렸|잘못된|아니야|아니에요/;

export type SelfstudyLastRun = {
  finished_at: string;
  submitted: number;
  skipped: boolean;
  message: string;
  ids: string[];
};

export type SelfstudyRunResult = SelfstudyLastRun & {
  ok: true;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type StuckMoment = {
  kind: "search_zero" | "clarify_unresolved" | "correction";
  conversation_id: string;
  user_id: string;
  user_name: string;
  snippet: string;
  at: string;
};

type GeneratedQuestion = {
  question: string;
  topic: string;
  conversation_id: string;
  user_id: string;
  user_name: string;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/** KST 하루 구간 → UTC ISO */
export function kstDayBounds(now = new Date()): {
  startIso: string;
  endIso: string;
} {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const startUtc = Date.UTC(y, m, d) - 9 * 60 * 60 * 1000;
  return {
    startIso: new Date(startUtc).toISOString(),
    endIso: new Date(startUtc + 24 * 60 * 60 * 1000).toISOString()
  };
}

function cardCount(meta: Record<string, unknown> | null): number {
  if (!meta) return 0;
  const cards = meta.cards;
  const notion = meta.notion_sources;
  const nCards = Array.isArray(cards) ? cards.length : 0;
  const nNotion = Array.isArray(notion) ? notion.length : 0;
  return nCards + nNotion;
}

function searchAttempted(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  const rounds = meta.search_rounds;
  if (typeof rounds === "number" && rounds > 0) return true;
  if (Array.isArray(meta.cards)) return true;
  if (Array.isArray(meta.notion_sources)) return true;
  if (Array.isArray(meta.ws_tool_calls) && meta.ws_tool_calls.length > 0) {
    return true;
  }
  return false;
}

async function countTodaySelfstudy(
  admin: SupabaseClient
): Promise<number> {
  const { startIso, endIso } = kstDayBounds();
  const { count, error } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("source", "selfstudy")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (error) {
    console.error("[luna/selfstudy] countToday", error);
    return MAX_PER_DAY; // 안전하게 skip
  }
  return count ?? 0;
}

async function saveLastRun(
  admin: SupabaseClient,
  run: SelfstudyLastRun
): Promise<void> {
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: SETTINGS_KEY,
      value: run,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) console.error("[luna/selfstudy] saveLastRun", error);
}

export async function getSelfstudyStatus(
  admin: SupabaseClient
): Promise<{ last_run: SelfstudyLastRun | null; today_count: number }> {
  const today_count = await countTodaySelfstudy(admin);
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) {
    console.error("[luna/selfstudy] getStatus", error);
    return { last_run: null, today_count };
  }
  const v = data?.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { last_run: null, today_count };
  }
  const row = v as Record<string, unknown>;
  return {
    last_run: {
      finished_at:
        typeof row.finished_at === "string"
          ? row.finished_at
          : new Date().toISOString(),
      submitted: typeof row.submitted === "number" ? row.submitted : 0,
      skipped: row.skipped === true,
      message: typeof row.message === "string" ? row.message : "",
      ids: Array.isArray(row.ids)
        ? row.ids.filter((x): x is string => typeof x === "string")
        : []
    },
    today_count
  };
}

async function extractStuckMoments(
  admin: SupabaseClient
): Promise<StuckMoment[]> {
  const { startIso, endIso } = kstDayBounds();

  const { data: convs, error: convErr } = await admin
    .from("luna_conversations")
    .select("id, user_id")
    .gte("updated_at", startIso)
    .lt("updated_at", endIso)
    .limit(200);

  if (convErr) {
    console.error("[luna/selfstudy] conversations", convErr);
    return [];
  }
  if (!convs?.length) return [];

  const convIds = convs.map((c) => c.id as string);
  const userIds = Array.from(
    new Set(convs.map((c) => c.user_id as string).filter(Boolean))
  );

  const [{ data: profiles }, { data: messages, error: msgErr }] =
    await Promise.all([
      admin.from("profiles").select("id, name").in("id", userIds),
      admin
        .from("luna_messages")
        .select("id, conversation_id, role, content, metadata, created_at")
        .in("conversation_id", convIds)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("created_at", { ascending: true })
        .limit(2000)
    ]);

  if (msgErr) {
    console.error("[luna/selfstudy] messages", msgErr);
    return [];
  }

  const nameByUser = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (typeof p.name === "string" && p.name.trim()) {
      nameByUser.set(p.id as string, p.name.trim());
    }
  }
  const userByConv = new Map<string, string>();
  for (const c of convs) {
    userByConv.set(c.id as string, c.user_id as string);
  }

  const byConv = new Map<string, MsgRow[]>();
  for (const raw of messages ?? []) {
    const m: MsgRow = {
      id: raw.id as string,
      conversation_id: raw.conversation_id as string,
      role: raw.role as string,
      content: typeof raw.content === "string" ? raw.content : "",
      metadata:
        raw.metadata && typeof raw.metadata === "object"
          ? (raw.metadata as Record<string, unknown>)
          : null,
      created_at: raw.created_at as string
    };
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }

  const out: StuckMoment[] = [];

  for (const [conversation_id, list] of byConv) {
    const user_id = userByConv.get(conversation_id) ?? "";
    const user_name = nameByUser.get(user_id) || "동료";

    for (let i = 0; i < list.length; i += 1) {
      const m = list[i]!;
      if (m.role === "assistant") {
        const meta = m.metadata;
        const clarify =
          meta && typeof meta === "object" && meta.clarify
            ? meta.clarify
            : null;

        if (searchAttempted(meta) && cardCount(meta) === 0) {
          const prevUser = [...list.slice(0, i)]
            .reverse()
            .find((x) => x.role === "user");
          out.push({
            kind: "search_zero",
            conversation_id,
            user_id,
            user_name,
            snippet: `검색 0건. 질문: ${(prevUser?.content || "").slice(0, 200)} / 답: ${m.content.slice(0, 200)}`,
            at: m.created_at
          });
        }

        if (clarify) {
          const nextUser = list
            .slice(i + 1)
            .find((x) => x.role === "user");
          const afterUserIdx = nextUser
            ? list.findIndex((x) => x.id === nextUser.id)
            : -1;
          const nextAssistant =
            afterUserIdx >= 0
              ? list.slice(afterUserIdx + 1).find((x) => x.role === "assistant")
              : null;
          const unresolved =
            !nextUser ||
            !nextAssistant ||
            Boolean(
              nextAssistant.metadata &&
                typeof nextAssistant.metadata === "object" &&
                nextAssistant.metadata.clarify
            ) ||
            (searchAttempted(nextAssistant.metadata) &&
              cardCount(nextAssistant.metadata) === 0);
          if (unresolved) {
            const q =
              typeof (clarify as { question?: unknown }).question === "string"
                ? (clarify as { question: string }).question
                : m.content.slice(0, 200);
            out.push({
              kind: "clarify_unresolved",
              conversation_id,
              user_id,
              user_name,
              snippet: `되묻기 미해소: ${q}`,
              at: m.created_at
            });
          }
        }
      }

      if (m.role === "user" && CORRECTION_RE.test(m.content)) {
        const prevAsst = [...list.slice(0, i)]
          .reverse()
          .find((x) => x.role === "assistant");
        out.push({
          kind: "correction",
          conversation_id,
          user_id,
          user_name,
          snippet: `정정: ${m.content.slice(0, 200)}${
            prevAsst ? ` (이전 답: ${prevAsst.content.slice(0, 120)})` : ""
          }`,
          at: m.created_at
        });
      }
    }
  }

  // 중복 스니펫 축소
  const seen = new Set<string>();
  const unique: StuckMoment[] = [];
  for (const s of out) {
    const key = `${s.kind}:${s.conversation_id}:${s.snippet.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    if (unique.length >= 20) break;
  }
  return unique;
}

async function generateQuestions(
  admin: SupabaseClient,
  stuck: StuckMoment[]
): Promise<GeneratedQuestion[]> {
  const client = getAnthropicClient();
  if (!client || stuck.length === 0) return [];

  const system =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.selfstudy)).trim() ||
    SELFSTUDY_FALLBACK;
  const tierB = resolveAnthropicModel(await getTierModel(admin, "B"));

  const evidenceBlock = stuck
    .map(
      (s, i) =>
        `${i + 1}. [${s.kind}] ${s.user_name} (user=${s.user_id}, conv=${s.conversation_id})\n${s.snippet}`
    )
    .join("\n\n");

  let raw = "";
  try {
    const res = await client.messages.create({
      model: tierB.model_id,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: `아래는 오늘 대화에서 추출한 "막힌 순간"입니다. 이중에서만 스스로 공부할 질문 0~${MAX_PER_DAY}개를 만드세요. 임의 주제 금지. JSON 배열만.\n\n${evidenceBlock}`
        }
      ]
    });
    raw = res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  } catch (err) {
    console.error("[luna/selfstudy] generateQuestions", err);
    return [];
  }

  const arr = parseJsonArray(raw);
  if (!arr) {
    const obj = parseJsonObject(raw);
    const nested = obj && Array.isArray(obj.questions) ? obj.questions : null;
    if (!nested) {
      console.warn("[luna/selfstudy] question JSON parse failed → 0");
      return [];
    }
    return normalizeQuestions(nested, stuck);
  }
  return normalizeQuestions(arr, stuck);
}

function normalizeQuestions(
  raw: unknown[],
  stuck: StuckMoment[]
): GeneratedQuestion[] {
  const fallback = stuck[0];
  const out: GeneratedQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const question =
      typeof row.question === "string"
        ? row.question.trim()
        : typeof row.ask === "string"
          ? row.ask.trim()
          : "";
    if (!question) continue;
    const topic =
      typeof row.topic === "string" && row.topic.trim()
        ? row.topic.trim()
        : question.slice(0, 40);
    const conversation_id =
      typeof row.conversation_id === "string" && row.conversation_id.trim()
        ? row.conversation_id.trim()
        : fallback?.conversation_id || "";
    const user_id =
      typeof row.user_id === "string" && row.user_id.trim()
        ? row.user_id.trim()
        : fallback?.user_id || "";
    const user_name =
      typeof row.user_name === "string" && row.user_name.trim()
        ? row.user_name.trim()
        : fallback?.user_name || "동료";
    if (!conversation_id || !user_id) continue;
    out.push({ question, topic, conversation_id, user_id, user_name });
    if (out.length >= MAX_PER_DAY) break;
  }
  return out;
}

async function answerAndSubmit(
  admin: SupabaseClient,
  q: GeneratedQuestion
): Promise<string | null> {
  let answer = "";
  try {
    const turn = await runLunaTurn(admin, q.question, {
      notion: true,
      web: true,
      nas: true
    });
    answer = turn.answer.trim();
  } catch (err) {
    console.error("[luna/selfstudy] runLunaTurn", err);
    return null;
  }
  if (!answer) return null;

  const content = answer.length > 800 ? `${answer.slice(0, 800)}…` : answer;
  const evidence = `출처: 오늘 ${q.user_name}와의 대화에서 막힌 주제`;
  const firstAsk = `오늘 대화에서 ${q.topic}가 막혀서 스스로 정리해봤어요. 맞나요?`;

  const created = await createCandidate(admin, {
    content,
    evidence,
    category: "general",
    source: "selfstudy",
    author_id: q.user_id,
    assigned_to: q.user_id,
    source_conversation_id: q.conversation_id,
    raw_input: q.question,
    thread: [makeTurn("luna", firstAsk)],
    meta: {
      selfstudy: true,
      topic: q.topic,
      question: q.question
    }
  });

  return created?.id ?? null;
}

/**
 * 그날 막힌 것만 자습 → 후보함 제출.
 * force=false 이고 오늘 이미 생성분이 있으면 skip.
 */
export async function runDailySelfstudy(
  admin: SupabaseClient,
  opts?: { force?: boolean; notify?: boolean }
): Promise<SelfstudyRunResult> {
  const force = opts?.force === true;
  const notify = opts?.notify !== false;

  const todayCount = await countTodaySelfstudy(admin);
  if (!force && todayCount > 0) {
    const run: SelfstudyLastRun = {
      finished_at: new Date().toISOString(),
      submitted: 0,
      skipped: true,
      message: "이미 오늘 자습 생성분이 있어 skip",
      ids: []
    };
    await saveLastRun(admin, run);
    return { ok: true, ...run };
  }

  const stuck = await extractStuckMoments(admin);
  if (stuck.length === 0) {
    const run: SelfstudyLastRun = {
      finished_at: new Date().toISOString(),
      submitted: 0,
      skipped: true,
      message: "오늘은 자습할 것이 없음",
      ids: []
    };
    await saveLastRun(admin, run);
    return { ok: true, ...run };
  }

  const questions = await generateQuestions(admin, stuck);
  if (questions.length === 0) {
    const run: SelfstudyLastRun = {
      finished_at: new Date().toISOString(),
      submitted: 0,
      skipped: true,
      message: "오늘은 자습할 것이 없음",
      ids: []
    };
    await saveLastRun(admin, run);
    return { ok: true, ...run };
  }

  const remaining = force
    ? MAX_PER_DAY
    : Math.max(0, MAX_PER_DAY - todayCount);
  const ids: string[] = [];
  for (const q of questions.slice(0, remaining)) {
    const id = await answerAndSubmit(admin, q);
    if (id) ids.push(id);
  }

  const run: SelfstudyLastRun = {
    finished_at: new Date().toISOString(),
    submitted: ids.length,
    skipped: ids.length === 0,
    message:
      ids.length > 0
        ? `자습 문답 ${ids.length}건을 후보함에 제출했어요`
        : "오늘은 자습할 것이 없음",
    ids
  };
  await saveLastRun(admin, run);

  if (notify && ids.length > 0) {
    await lunaNotify(
      admin,
      "study",
      "자습 완료",
      `자습 문답 ${ids.length}건을 후보함에 제출했어요`,
      { level: "success", meta: { submitted: ids.length, ids } }
    );
  }

  return { ok: true, ...run };
}

// ── Legacy helpers (chat / learn) ────────────────────────────────

/** pg_trgm 과 유사한 3-gram Dice 유사도 */
export function trigramSimilarity(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;

  const grams = (s: string) => {
    const padded = `  ${s} `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i += 1) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  const ga = grams(left);
  const gb = grams(right);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return (2 * inter) / (ga.size + gb.size);
}

export function extractCoreTokens(folderName: string): string[] {
  const cleaned = folderName.replace(/^[-※\s]+/, "").trim();
  const parts = cleaned.split(/[\s_/\-·]+/).map((p) => p.trim()).filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    if (/^\d{4,}$/.test(part)) continue;
    if (/^\d+$/.test(part)) continue;
    if (part.length < 2) continue;
    if (/^(프로젝트|폴더|복사본|final|finals)$/i.test(part)) continue;
    tokens.push(part);
  }
  return tokens.slice(0, 6);
}

export async function findSimilarReport(
  admin: SupabaseClient,
  keywords: string
): Promise<LunaReportRow | null> {
  const q = keywords.trim();
  if (!q) return null;

  try {
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "luna_match_report",
      {
        p_query: q,
        p_threshold: REPORT_SIM_THRESHOLD,
        p_limit: 1
      }
    );
    if (!rpcError && Array.isArray(rpcData) && rpcData[0]) {
      return rpcData[0] as LunaReportRow;
    }
  } catch {
    /* fallback */
  }

  const { data, error } = await admin
    .from("luna_reports")
    .select(
      "id, topic, title, content, sources, queue_id, project_id, use_count, last_used_at, status, model_label, created_at"
    )
    .eq("status", "active")
    .limit(200);

  if (error) {
    console.error("[luna/selfstudy] findSimilarReport", error);
    return null;
  }

  let best: LunaReportRow | null = null;
  let bestScore = 0;
  for (const row of (data ?? []) as LunaReportRow[]) {
    const score = Math.max(
      trigramSimilarity(q, row.topic ?? ""),
      trigramSimilarity(q, row.title ?? "") * 0.9
    );
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || bestScore < REPORT_SIM_THRESHOLD) return null;
  return best;
}

export function bumpReportUse(admin: SupabaseClient, reportId: string): void {
  void (async () => {
    try {
      const { data } = await admin
        .from("luna_reports")
        .select("use_count")
        .eq("id", reportId)
        .maybeSingle();
      const prev = typeof data?.use_count === "number" ? data.use_count : 0;
      const { error } = await admin
        .from("luna_reports")
        .update({
          use_count: prev + 1,
          last_used_at: new Date().toISOString()
        })
        .eq("id", reportId);
      if (error) console.error("[luna/selfstudy] bumpReportUse", error);
    } catch (err) {
      console.error("[luna/selfstudy] bumpReportUse", err);
    }
  })();
}
