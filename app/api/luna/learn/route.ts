import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  createCandidate,
  firstTurnFallback,
  makeTurn,
  runDialogueTurn
} from "@/lib/luna/candidates";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import { getPrompt } from "@/lib/luna/prompts";
import { trigramSimilarity } from "@/lib/luna/selfstudy";

export const runtime = "nodejs";

const DIRECT_FALLBACK = `당신은 팀 지식을 정리하는 편집자입니다.
사용자가 알려준 내용을 한 문장으로 다듬고, 기존 지식과 중복/충돌을 판단하세요.
JSON만 응답:
{
  "status": "ok"|"duplicate"|"conflict",
  "message": "사용자에게 보여줄 한 줄",
  "content": "다듬은 지식 문장",
  "category": "term"|"criterion"|"workflow"|"client"|"preference",
  "removed": "제외한 내용이 있으면 한 줄, 없으면 빈 문자열",
  "conflict_with": "충돌하는 기존 지식 원문 (conflict일 때만)",
  "existing": "중복인 기존 지식 원문 (duplicate일 때만)"
}`;

const ALLOWED_CATEGORIES = new Set([
  "term",
  "criterion",
  "workflow",
  "client",
  "preference"
]);

const CATEGORY_ALIASES: Record<string, string> = {
  term: "term",
  용어: "term",
  criterion: "criterion",
  판단기준: "criterion",
  workflow: "workflow",
  업무방식: "workflow",
  style: "workflow",
  client: "client",
  클라이언트: "client",
  preference: "preference",
  선호: "preference",
  general: "term",
  project: "workflow"
};

type ActiveLearning = { id: string; content: string; category: string };

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

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
  if (start >= 0 && end > start) return tryParse(trimmed.slice(start, end + 1));
  return null;
}

function normalizeCategory(raw: unknown): string {
  if (typeof raw !== "string") return "term";
  const key = raw.trim();
  return CATEGORY_ALIASES[key] ?? CATEGORY_ALIASES[key.toLowerCase()] ?? "term";
}

/** 이번 주 월요일 00:00 KST */
function startOfWeekKstIso(): string {
  const now = Date.now();
  const kstMs = now + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const startUtcMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - diff) -
    9 * 60 * 60 * 1000;
  return new Date(startUtcMs).toISOString();
}

async function countWeekDirect(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  userId: string
): Promise<number> {
  const { count, error } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("origin", "direct")
    .eq("author_id", userId)
    .gte("created_at", startOfWeekKstIso())
    .neq("category", "identity");
  if (error) {
    console.error("[luna/learn] week count", error);
    return 0;
  }
  return count ?? 0;
}

async function findSimilarActive(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  text: string
): Promise<ActiveLearning[]> {
  try {
    const { data, error } = await admin.rpc("luna_match_learning", {
      p_query: text,
      p_limit: 5
    });
    if (!error && Array.isArray(data)) {
      return data
        .filter(
          (r): r is ActiveLearning =>
            Boolean(r) &&
            typeof (r as { id?: unknown }).id === "string" &&
            typeof (r as { content?: unknown }).content === "string"
        )
        .map((r) => ({
          id: r.id,
          content: r.content,
          category:
            typeof (r as { category?: unknown }).category === "string"
              ? ((r as { category: string }).category)
              : "general"
        }))
        .slice(0, 5);
    }
    if (error) {
      console.warn("[luna/learn] luna_match_learning", error.message);
    }
  } catch (err) {
    console.warn("[luna/learn] rpc fallback", err);
  }

  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, category")
    .eq("status", "active")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[luna/learn] similar fetch", error);
    return [];
  }

  return ((data ?? []) as ActiveLearning[])
    .map((r) => ({
      row: r,
      score: trigramSimilarity(text, r.content)
    }))
    .filter((x) => x.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.row);
}

async function findActiveByContent(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  content: string
): Promise<ActiveLearning | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const { data, error } = await admin
    .from("luna_learnings")
    .select("id, content, category")
    .eq("status", "active")
    .neq("category", "identity")
    .eq("content", trimmed)
    .maybeSingle();
  if (error) {
    console.error("[luna/learn] find by content", error);
    return null;
  }
  if (data) return data as ActiveLearning;

  const similars = await findSimilarActive(admin, trimmed);
  const best = similars[0];
  if (best && trigramSimilarity(trimmed, best.content) >= 0.55) return best;
  return null;
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const weekCount = await countWeekDirect(admin, user.id);
  return NextResponse.json({ week_count: weekCount });
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { id?: string; category?: string };
  try {
    body = (await request.json()) as { id?: string; category?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const category = normalizeCategory(body.category);
  if (!id || !ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "id and valid category required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_learnings")
    .update({ category })
    .eq("id", id)
    .eq("author_id", user.id)
    .eq("origin", "direct")
    .select("id, category")
    .maybeSingle();

  if (error) {
    console.error("[luna/learn] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id: data.id, category: data.category });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { text?: string; category?: string; force?: string };
  try {
    body = (await request.json()) as {
      text?: string;
      category?: string;
      force?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const force =
    body.force === "replace" || body.force === "both" ? body.force : null;
  const categoryOverride =
    typeof body.category === "string" && body.category.trim()
      ? normalizeCategory(body.category)
      : null;

  const client = getAnthropicClient();
  if (!client) {
    return NextResponse.json({ error: "Claude API key is not configured" }, { status: 500 });
  }

  const similar = await findSimilarActive(admin, text);
  const tierB = resolveAnthropicModel(await getTierModel(admin, "B"));
  const systemPrompt =
    (await getPrompt(admin, "knowledge.direct")).trim() || DIRECT_FALLBACK;

  const userPayload = [
    `사용자 입력:\n${text}`,
    similar.length > 0
      ? `기존 활성 지식 (유사 상위):\n${JSON.stringify(similar, null, 2)}`
      : "기존 활성 지식: (유사 항목 없음)"
  ].join("\n\n");

  let parsed: Record<string, unknown> | null = null;
  try {
    const res = await client.messages.create({
      model: tierB.model_id,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPayload }]
    });
    const raw =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    parsed = parseJsonObject(raw);
  } catch (err) {
    console.error("[luna/learn] model", err);
    return NextResponse.json({ error: "Learn model failed" }, { status: 500 });
  }

  if (!parsed) {
    return NextResponse.json({ error: "Failed to parse model response" }, { status: 500 });
  }

  const statusRaw = typeof parsed.status === "string" ? parsed.status.trim() : "ok";
  const status =
    statusRaw === "duplicate" || statusRaw === "conflict" || statusRaw === "ok"
      ? statusRaw
      : "ok";
  const message =
    typeof parsed.message === "string" ? parsed.message.trim() : "";
  const content =
    typeof parsed.content === "string" ? parsed.content.trim() : "";
  const removed =
    typeof parsed.removed === "string" ? parsed.removed.trim() : "";
  const conflictWith =
    typeof parsed.conflict_with === "string" ? parsed.conflict_with.trim() : "";
  const existing =
    typeof parsed.existing === "string" ? parsed.existing.trim() : "";
  const category = categoryOverride ?? normalizeCategory(parsed.category);

  const weekCount = await countWeekDirect(admin, user.id);

  if (status === "duplicate") {
    return NextResponse.json({
      status: "duplicate",
      message: message || "이미 알고 있어요",
      content,
      category,
      removed,
      existing: existing || content,
      week_count: weekCount
    });
  }

  if (status === "conflict" && !force) {
    return NextResponse.json({
      status: "conflict",
      message: message || "기존 지식과 충돌해요",
      content,
      category,
      removed,
      conflict_with: conflictWith || existing,
      week_count: weekCount
    });
  }

  if (force === "replace" && conflictWith) {
    const target = await findActiveByContent(admin, conflictWith);
    if (target) {
      const { error: archErr } = await admin
        .from("luna_learnings")
        .update({ status: "archived" })
        .eq("id", target.id)
        .eq("status", "active");
      if (archErr) {
        console.error("[luna/learn] archive conflict", archErr);
      }
    }
  }

  const insertContent = content || text;
  const lunaFirst =
    (await runDialogueTurn(admin, {
      mode: "first",
      content: insertContent,
      evidence: text
    })) || firstTurnFallback(insertContent);

  const created = await createCandidate(admin, {
    content: insertContent,
    evidence: text,
    category: ALLOWED_CATEGORIES.has(category) ? category : "term",
    source: "direct",
    author_id: user.id,
    assigned_to: user.id,
    raw_input: text,
    thread: [makeTurn("luna", lunaFirst)],
    scope_suggestion: null
  });

  if (!created) {
    return NextResponse.json({ error: "Failed to create candidate" }, { status: 500 });
  }

  const newWeekCount = await countWeekDirect(admin, user.id);

  return NextResponse.json({
    status: "ok",
    message: message || "후보함에 넣었어요. 맞는지 확인해 주세요.",
    content: created.content,
    category: ALLOWED_CATEGORIES.has(category) ? category : "term",
    removed,
    id: created.id,
    week_count: newWeekCount,
    candidate: true,
    thread: created.thread
  });
}
