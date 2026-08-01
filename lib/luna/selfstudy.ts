import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getTierModel,
  readUsage,
  resolveAnthropicModel,
  bumpUsageDaily
} from "@/lib/luna/engine";
import { searchNotionPages } from "@/lib/luna/notion";
import { getPrompt } from "@/lib/luna/prompts";
import { searchTavily, type LunaCard } from "@/lib/luna/tavily";
import {
  listFolder,
  searchAll,
  searchIn,
  searchNasLegacy,
  type WorkserverItem
} from "@/lib/luna/workserver";

export type SelfstudySource = "frequency" | "failure" | "manual" | "project";
export type SelfstudyQueueStatus = "pending" | "running" | "done" | "skipped";

export type SelfstudyQueueRow = {
  id: string;
  topic: string;
  source: SelfstudySource;
  score: number;
  evidence: Record<string, unknown> | null;
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

export type PickedTopic = {
  topic: string;
  source: SelfstudySource;
  score: number;
  evidence?: Record<string, unknown>;
  project_id?: string | null;
};

const PROJECT_ROOTS = ["02 Project", "01 사업개발"] as const;
const REPORT_SIM_THRESHOLD = 0.3;
const WS_TOOL_LOOP_MS = 25_000;
const MAX_WS_TOOL_ROUNDS = 5;

const WORKSERVER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_folder",
    description: "Work서버 특정 경로 바로 아래 항목 보기. 경로를 비우면 최상위",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        drive: { type: "string" }
      }
    }
  },
  {
    name: "search_in",
    description: "Work서버 특정 경로 아래에서만 검색",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        keywords: { type: "string" }
      },
      required: ["path", "keywords"]
    }
  },
  {
    name: "search_all",
    description: "Work서버 전체 검색. 어디를 볼지 모를 때만",
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "string" }
      },
      required: ["keywords"]
    }
  }
];

const PICK_FALLBACK =
  "아래 근거를 보고 자습할 주제를 JSON 배열로만 고르세요. 각 항목: {\"topic\",\"source\":\"frequency|failure|project|manual\",\"score\":0~1,\"evidence\":{}}. 이미 있는 리포트 topic 과 중복되지 않게 하세요. 최대 8개.";

const REPORT_FALLBACK =
  "주제와 수집 자료를 바탕으로 아폴론 내부용 정리 리포트를 작성하세요. JSON만: {\"title\":\"...\",\"content\":\"마크다운 본문\"}";

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const tryParse = (raw: string) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence !== null) return fromFence;
  }
  const arrStart = trimmed.indexOf("[");
  const arrEnd = trimmed.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const fromArr = tryParse(trimmed.slice(arrStart, arrEnd + 1));
    if (fromArr !== null) return fromArr;
  }
  const objStart = trimmed.indexOf("{");
  const objEnd = trimmed.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    return tryParse(trimmed.slice(objStart, objEnd + 1));
  }
  return null;
}

function asSource(raw: unknown): SelfstudySource | null {
  if (
    raw === "frequency" ||
    raw === "failure" ||
    raw === "manual" ||
    raw === "project"
  ) {
    return raw;
  }
  return null;
}

function normalizePicked(raw: unknown): PickedTopic[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.topics)) list = obj.topics;
    else if (Array.isArray(obj.items)) list = obj.items;
  }

  const out: PickedTopic[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const topic = typeof row.topic === "string" ? row.topic.trim() : "";
    const source = asSource(row.source) ?? "manual";
    if (!topic) continue;
    const scoreRaw = row.score;
    const score =
      typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
        ? Math.max(0, Math.min(1, scoreRaw))
        : 0.5;
    const evidence =
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : typeof row.reason === "string"
          ? { reason: row.reason }
          : {};
    const project_id =
      typeof row.project_id === "string" && row.project_id.trim()
        ? row.project_id.trim()
        : null;
    out.push({ topic, source, score, evidence, project_id });
  }
  return out.slice(0, 8);
}

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

type ProjectFolder = { name: string; path: string };

function isFileType(type: string | null | undefined): boolean {
  return (type ?? "").toLowerCase() === "file";
}

function isYearFolder(name: string): boolean {
  return /^\d{4}$/.test(name.trim());
}

/** '240910 인스파이어 시즌3 쇼콘텐츠제작' → ['인스파이어','시즌3','쇼콘텐츠제작'] */
export function extractCoreTokens(folderName: string): string[] {
  const cleaned = folderName.replace(/^[-※\s]+/, "").trim();
  const parts = cleaned.split(/[\s_/\-·]+/).map((p) => p.trim()).filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    if (/^\d{4,}$/.test(part)) continue; // 240910, 2024
    if (/^\d+$/.test(part)) continue;
    if (part.length < 2) continue;
    if (/^(프로젝트|폴더|복사본|final|finals)$/i.test(part)) continue;
    tokens.push(part);
  }
  return tokens.slice(0, 6);
}

/** 02 Project / 01 사업개발 아래 프로젝트 폴더 (연도 한 단계 더 진입) */
async function listProjectFolders(
  admin: SupabaseClient
): Promise<ProjectFolder[]> {
  const found = new Map<string, ProjectFolder>();

  for (const root of PROJECT_ROOTS) {
    try {
      const top = await listFolder(admin, root);
      for (const item of top) {
        if (isFileType(item.type)) continue;
        const name = item.name?.trim();
        if (!name) continue;

        if (isYearFolder(name)) {
          const children = await listFolder(admin, item.path);
          for (const child of children) {
            if (isFileType(child.type)) continue;
            const childName = child.name?.trim();
            if (!childName || isYearFolder(childName)) continue;
            found.set(child.path, { name: childName, path: child.path });
          }
        } else {
          found.set(item.path, { name, path: item.path });
        }
      }
    } catch (err) {
      console.error("[luna/selfstudy] listFolder", root, err);
    }
  }

  return Array.from(found.values());
}

async function countMentions(
  admin: SupabaseClient,
  folders: ProjectFolder[]
): Promise<Array<{ name: string; path: string; count: number; tokens: string[] }>> {
  if (folders.length === 0) return [];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("luna_messages")
    .select("content")
    .eq("role", "user")
    .gte("created_at", since)
    .limit(4000);

  if (error) {
    console.error("[luna/selfstudy] messages", error);
    return [];
  }

  const folderTokens = folders.map((f) => ({
    ...f,
    tokens: extractCoreTokens(f.name)
  }));

  const counts = new Map<string, number>();
  for (const f of folderTokens) counts.set(f.path, 0);

  for (const row of data ?? []) {
    const content = typeof row.content === "string" ? row.content : "";
    if (!content) continue;
    const lower = content.toLowerCase();
    for (const f of folderTokens) {
      const fullHit = lower.includes(f.name.toLowerCase());
      const tokenHit = f.tokens.some(
        (t) => t.length >= 2 && lower.includes(t.toLowerCase())
      );
      if (fullHit || tokenHit) {
        counts.set(f.path, (counts.get(f.path) ?? 0) + 1);
      }
    }
  }

  return folderTokens
    .map((f) => ({
      name: f.name,
      path: f.path,
      tokens: f.tokens,
      count: counts.get(f.path) ?? 0
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

/** importance>0 경로가 가장 많은 프로젝트 폴더 상위 N */
async function topImportantProjectFolders(
  admin: SupabaseClient,
  limit = 5
): Promise<Array<{ name: string; path: string; importantCount: number }>> {
  const { data, error } = await admin
    .from("nas_directory")
    .select("path")
    .gt("importance", 0)
    .limit(8000);

  if (error) {
    console.error("[luna/selfstudy] important paths", error);
    return [];
  }

  const counts = new Map<
    string,
    { name: string; path: string; importantCount: number }
  >();

  for (const row of data ?? []) {
    const raw = typeof row.path === "string" ? row.path : "";
    if (!raw) continue;
    const segs = raw.replace(/\//g, "\\").split("\\").filter(Boolean);
    if (segs.length < 2) continue;
    const root = segs[0]!;
    if (!(PROJECT_ROOTS as readonly string[]).includes(root)) continue;

    let projectName: string;
    let projectPath: string;
    if (segs.length >= 3 && isYearFolder(segs[1]!)) {
      projectName = segs[2]!;
      projectPath = `${segs[0]}\\${segs[1]}\\${segs[2]}`;
    } else {
      projectName = segs[1]!;
      projectPath = `${segs[0]}\\${segs[1]}`;
    }
    if (!projectName || isYearFolder(projectName)) continue;

    const prev = counts.get(projectPath);
    if (prev) prev.importantCount += 1;
    else {
      counts.set(projectPath, {
        name: projectName,
        path: projectPath,
        importantCount: 1
      });
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.importantCount - a.importantCount)
    .slice(0, limit);
}

async function collectFailures(admin: SupabaseClient): Promise<
  Array<{ question: string; reason: string; created_at: string }>
> {
  const { data, error } = await admin
    .from("luna_trace_weekly")
    .select("top_failures, week_start")
    .order("week_start", { ascending: false })
    .limit(2);

  if (error) {
    console.error("[luna/selfstudy] trace_weekly", error);
    return [];
  }

  const out: Array<{ question: string; reason: string; created_at: string }> =
    [];
  for (const week of data ?? []) {
    const failures = week.top_failures;
    if (!Array.isArray(failures)) continue;
    for (const f of failures) {
      if (!f || typeof f !== "object") continue;
      const row = f as Record<string, unknown>;
      const question =
        typeof row.question === "string" ? row.question.trim() : "";
      if (!question) continue;
      out.push({
        question,
        reason: typeof row.reason === "string" ? row.reason : "",
        created_at:
          typeof row.created_at === "string" ? row.created_at : ""
      });
    }
  }
  return out;
}

export async function pickSelfstudyTopics(
  admin: SupabaseClient
): Promise<{ picked: number; topics: PickedTopic[]; reason?: string }> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Claude API key is not configured");

  const folders = await listProjectFolders(admin);
  const frequency = await countMentions(admin, folders);
  const failures = await collectFailures(admin);

  const [{ data: projects }, { data: reports }] = await Promise.all([
    admin.from("luna_projects").select("id, name, description, project_code"),
    admin.from("luna_reports").select("topic").eq("status", "active")
  ]);

  const projectRows = projects ?? [];
  const existingTopics = (reports ?? [])
    .map((r) => (typeof r.topic === "string" ? r.topic : ""))
    .filter(Boolean);

  // 빈도 후보가 3개 미만이면 importance 많은 프로젝트 폴더로 보강
  let importantProjects: Array<{
    name: string;
    path: string;
    importantCount: number;
  }> = [];
  if (frequency.length < 3) {
    importantProjects = await topImportantProjectFolders(admin, 5);
  }

  console.log("[luna/selfstudy] evidence", {
    frequencyCount: frequency.length,
    failureCount: failures.length,
    projectCount: projectRows.length,
    existingReports: existingTopics.length,
    folderCount: folders.length,
    importantFallback: importantProjects.length
  });

  const hasEvidence =
    frequency.length > 0 ||
    failures.length > 0 ||
    projectRows.length > 0 ||
    importantProjects.length > 0;

  if (!hasEvidence) {
    console.log("[luna/selfstudy] pick early exit: 근거 없음");
    return { picked: 0, topics: [], reason: "근거 없음" };
  }

  const evidenceBundle = {
    frequency_top: frequency.map((f) => ({
      name: f.name,
      path: f.path,
      count: f.count,
      tokens: f.tokens
    })),
    failures,
    projects: projectRows,
    important_projects: importantProjects,
    existing_report_topics: existingTopics
  };

  const tierCCfg = await getTierModel(admin, "C");
  const tierC = resolveAnthropicModel(tierCCfg);
  const pickPrompt =
    (await getPrompt(admin, "selfstudy.pick")).trim() || PICK_FALLBACK;

  const res = await client.messages.create({
    model: tierC.model_id,
    max_tokens: 2048,
    system: pickPrompt,
    messages: [
      {
        role: "user",
        content: `자습 주제 선정 근거:\n${JSON.stringify(evidenceBundle, null, 2)}\n\n규칙: frequency_top / failures / projects / important_projects 를 참고해 주제를 고르세요. important_projects 는 source=\"project\" 로 써도 됩니다. 이미 existing_report_topics 에 있는 주제는 피하세요.`
      }
    ]
  });

  bumpUsageDaily(admin, {
    tier: "C",
    model_id: tierC.model_id,
    usage: readUsage(res.usage)
  });

  const rawText =
    res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  console.log("[luna/selfstudy] raw", rawText.slice(0, 500));

  const parsed = parseJsonValue(rawText);
  if (parsed === null) {
    console.error("[luna/selfstudy] JSON parse failed");
    return {
      picked: 0,
      topics: [],
      reason: "모델 응답 파싱 실패"
    };
  }

  let topics = normalizePicked(parsed);

  // 모델이 비워도 important_projects 로 최소 후보 확보
  if (topics.length === 0 && importantProjects.length > 0) {
    topics = importantProjects.slice(0, 5).map((p, i) => ({
      topic: p.name,
      source: "project" as const,
      score: Math.max(0.3, 0.9 - i * 0.1),
      evidence: {
        summary: "importance 경로 수 기반 폴백",
        path: p.path,
        importantCount: p.importantCount
      },
      project_id: null
    }));
    console.log("[luna/selfstudy] fallback topics from important_projects");
  }

  for (const t of topics) {
    if (!t.evidence || Object.keys(t.evidence).length === 0) {
      t.evidence = {
        summary: `${t.source} 기반 선정`,
        frequency_hint: frequency.slice(0, 5),
        failure_hint: failures.slice(0, 3),
        important_hint: importantProjects.slice(0, 3)
      };
    }
  }

  let picked = 0;
  for (const t of topics) {
    const { data: existing } = await admin
      .from("luna_selfstudy_queue")
      .select("id, status")
      .eq("topic", t.topic)
      .eq("source", t.source)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await admin
        .from("luna_selfstudy_queue")
        .update({
          score: t.score,
          evidence: t.evidence ?? {},
          project_id: t.project_id ?? null
        })
        .eq("id", existing.id);
      if (error) {
        console.error("[luna/selfstudy] upsert update", error);
        continue;
      }
      picked += 1;
    } else {
      const { error } = await admin.from("luna_selfstudy_queue").insert({
        topic: t.topic,
        source: t.source,
        score: t.score,
        evidence: t.evidence ?? {},
        status: "pending",
        project_id: t.project_id ?? null
      });
      if (error) {
        console.error("[luna/selfstudy] upsert insert", error);
        continue;
      }
      picked += 1;
    }
  }

  console.log("[luna/selfstudy] pick", picked, topics.map((t) => t.topic));
  return { picked, topics };
}

async function exploreWorkserverForTopic(
  admin: SupabaseClient,
  client: Anthropic,
  modelId: string,
  topic: string
): Promise<WorkserverItem[]> {
  const explorePrompt = [
    (await getPrompt(admin, "connector.workserver")).trim(),
    (await getPrompt(admin, "connector.workserver.explore")).trim()
  ]
    .filter(Boolean)
    .join("\n\n");

  const loopStarted = Date.now();
  const collected = new Map<string, WorkserverItem>();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `자습 주제: ${topic}\n관련 Work서버 자료를 importance 높은 것 위주로 찾아주세요.`
    }
  ];

  try {
    for (let round = 0; round < MAX_WS_TOOL_ROUNDS; round += 1) {
      if (Date.now() - loopStarted > WS_TOOL_LOOP_MS) break;

      const res = await client.messages.create({
        model: modelId,
        max_tokens: 1024,
        system:
          explorePrompt ||
          "Work서버 폴더를 단계적으로 탐색해 관련 자료를 찾으세요. importance 높은 항목을 우선하세요.",
        tools: WORKSERVER_TOOLS,
        messages
      });

      bumpUsageDaily(admin, {
        tier: "C",
        model_id: modelId,
        usage: readUsage(res.usage)
      });

      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (toolUses.length === 0) break;

      messages.push({ role: "assistant", content: res.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        const input =
          tu.input && typeof tu.input === "object"
            ? (tu.input as Record<string, unknown>)
            : {};
        let items: WorkserverItem[] = [];
        try {
          if (tu.name === "list_folder") {
            items = await listFolder(
              admin,
              typeof input.path === "string" ? input.path : "",
              typeof input.drive === "string" ? input.drive : undefined
            );
          } else if (tu.name === "search_in") {
            items = await searchIn(
              admin,
              typeof input.path === "string" ? input.path : "",
              typeof input.keywords === "string" ? input.keywords : topic,
              typeof input.drive === "string" ? input.drive : undefined
            );
          } else if (tu.name === "search_all") {
            items = await searchAll(
              admin,
              typeof input.keywords === "string" ? input.keywords : topic
            );
          }
        } catch (err) {
          console.error("[luna/selfstudy] ws tool", tu.name, err);
          items = [];
        }

        for (const item of items) {
          const key = `${item.drive ?? ""}::${item.path}`;
          if (!collected.has(key)) collected.set(key, item);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(items)
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    console.error("[luna/selfstudy] ws explore failed, legacy", err);
    const legacy = await searchNasLegacy(admin, topic);
    for (const row of legacy) {
      const item: WorkserverItem = {
        drive: row.drive,
        path: row.path,
        name: row.path.split(/[\\/]/).filter(Boolean).pop() || row.path,
        type: row.type,
        importance: row.importance,
        file_summary: row.file_summary
      };
      collected.set(`${item.drive ?? ""}::${item.path}`, item);
    }
  }

  return Array.from(collected.values())
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 12);
}

export async function runSelfstudyQueueItem(
  admin: SupabaseClient,
  queueId?: string | null
): Promise<{ report_id: string; queue_id: string; topic: string }> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Claude API key is not configured");

  let item: SelfstudyQueueRow | null = null;

  if (queueId) {
    const { data, error } = await admin
      .from("luna_selfstudy_queue")
      .select("*")
      .eq("id", queueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    item = data as SelfstudyQueueRow | null;
  } else {
    const { data, error } = await admin
      .from("luna_selfstudy_queue")
      .select("*")
      .eq("status", "pending")
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    item = data as SelfstudyQueueRow | null;
  }

  if (!item) {
    throw new Error("No pending selfstudy queue item");
  }

  const { error: runErr } = await admin
    .from("luna_selfstudy_queue")
    .update({ status: "running" })
    .eq("id", item.id);
  if (runErr) throw new Error(runErr.message);

  try {
    const tierCCfg = await getTierModel(admin, "C");
    const tierC = resolveAnthropicModel(tierCCfg);
    const webHint = (await getPrompt(admin, "connector.web.hint")).trim();

    // 노션 → Work서버 → 웹 순서
    const notionSources = await searchNotionPages(item.topic);
    const nasItems = await exploreWorkserverForTopic(
      admin,
      client,
      tierC.model_id,
      item.topic
    );
    const webCards = await searchTavily(item.topic, webHint);

    const sources: Array<{ type: string; title: string; ref: string }> = [];
    for (const n of notionSources) {
      sources.push({ type: "notion", title: n.title, ref: n.url });
    }
    for (const n of nasItems) {
      sources.push({
        type: "nas",
        title: n.name,
        ref: n.path
      });
    }
    for (const w of webCards as LunaCard[]) {
      sources.push({
        type: "web",
        title: w.title,
        ref: w.url || w.description
      });
    }

    const materialBlock = [
      "### 노션",
      ...notionSources.map((s) => `- ${s.title}: ${s.url}`),
      "### Work서버",
      ...nasItems.map(
        (s) =>
          `- ${s.name} (${s.path})${s.file_summary ? ` — ${s.file_summary}` : ""}${
            (s.importance ?? 0) > 0 ? " ★" : ""
          }`
      ),
      "### 웹",
      ...webCards.map((s) => `- ${s.title}: ${s.url ?? ""} — ${s.description}`)
    ].join("\n");

    const reportPrompt =
      (await getPrompt(admin, "selfstudy.report")).trim() || REPORT_FALLBACK;

    const reportRes = await client.messages.create({
      model: tierC.model_id,
      max_tokens: 4096,
      system: reportPrompt,
      messages: [
        {
          role: "user",
          content: `주제: ${item.topic}\n\n수집 자료:\n${materialBlock}`
        }
      ]
    });

    bumpUsageDaily(admin, {
      tier: "C",
      model_id: tierC.model_id,
      usage: readUsage(reportRes.usage)
    });

    const reportText =
      reportRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const parsed = parseJsonValue(reportText);
    let title = item.topic;
    let content = reportText;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.title === "string" && obj.title.trim()) {
        title = obj.title.trim();
      }
      if (typeof obj.content === "string" && obj.content.trim()) {
        content = obj.content.trim();
      }
    }

    const { data: report, error: insertErr } = await admin
      .from("luna_reports")
      .insert({
        topic: item.topic,
        title,
        content,
        sources,
        queue_id: item.id,
        project_id: item.project_id,
        use_count: 0,
        status: "active",
        model_label: tierC.model_label
      })
      .select("id")
      .single();

    if (insertErr || !report) {
      throw new Error(insertErr?.message || "Failed to insert report");
    }

    const { error: doneErr } = await admin
      .from("luna_selfstudy_queue")
      .update({
        status: "done",
        processed_at: new Date().toISOString()
      })
      .eq("id", item.id);
    if (doneErr) {
      console.error("[luna/selfstudy] mark done", doneErr);
    }

    console.log("[luna/selfstudy] run done", item.topic, report.id);
    return {
      report_id: report.id as string,
      queue_id: item.id,
      topic: item.topic
    };
  } catch (err) {
    await admin
      .from("luna_selfstudy_queue")
      .update({ status: "pending" })
      .eq("id", item.id);
    throw err;
  }
}

export async function findSimilarReport(
  admin: SupabaseClient,
  keywords: string
): Promise<LunaReportRow | null> {
  const q = keywords.trim();
  if (!q) return null;

  // pg_trgm RPC 가 있으면 우선 사용 (없어도 앱 폴백)
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
    /* fallback below */
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
  console.log("[luna/selfstudy] report match", {
    query: q,
    topic: best.topic,
    score: Number(bestScore.toFixed(3))
  });
  return best;
}

/** fire-and-forget use_count 갱신 */
export function bumpReportUse(admin: SupabaseClient, reportId: string): void {
  void (async () => {
    try {
      const { data } = await admin
        .from("luna_reports")
        .select("use_count")
        .eq("id", reportId)
        .maybeSingle();
      const prev =
        typeof data?.use_count === "number" ? data.use_count : 0;
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
