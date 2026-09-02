import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";
import { websiteAdminFetch } from "@/lib/website/client";
import { parseWorkDetail, tagLabel, type WorkDetail } from "@/lib/website/work-detail";

type SearchHit = {
  type: "work" | "insight" | "page";
  id: string;
  title: { ko?: string; en?: string } | string | null;
  slug: string;
  key_image: string | null;
  category: string | null;
  status: string;
  year?: string | null;
  published_at?: string | null;
};

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const RECOMMEND_TOOL: Anthropic.Messages.Tool = {
  name: "related_recommend",
  description: "이 워크와 어울리는 공개 콘텐츠 4개",
  input_schema: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["work", "insight"] },
            id: { type: "string" }
          },
          required: ["type", "id"]
        }
      },
      reason: {
        type: "string",
        description: "무엇을 기준으로 골랐는지 한국어 한 줄"
      }
    },
    required: ["picks", "reason"]
  }
};

function unwrapData<T>(body: unknown): T | null {
  if (!body || typeof body !== "object") return null;
  if ("data" in body) return (body as { data: T }).data;
  return null;
}

function locLine(value: { ko?: string; en?: string } | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return [value.ko, value.en].filter((part) => part && part.trim()).join(" / ");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function bodyText(work: WorkDetail): string {
  const parts: string[] = [];
  for (const section of work.work_sections ?? []) {
    if (section.kind === "interview") continue;
    const headline = locLine(section.headline);
    const lead = locLine(section.lead);
    if (headline) parts.push(headline);
    if (lead) parts.push(lead);
    for (const block of section.content_blocks ?? []) {
      if (!block.body) continue;
      if ("columns" in block.body) {
        for (const col of block.body.columns) {
          const text = stripHtml(locLine(col));
          if (text) parts.push(text);
        }
      } else {
        const text = stripHtml(locLine(block.body));
        if (text) parts.push(text);
      }
    }
  }
  return parts.join("\n").slice(0, 6000);
}

function hitTitle(hit: SearchHit): string {
  if (typeof hit.title === "string" && hit.title.trim()) return hit.title;
  if (hit.title && typeof hit.title === "object") {
    return hit.title.ko?.trim() || hit.title.en?.trim() || hit.slug || hit.id;
  }
  return hit.slug || hit.id;
}

function parseToolResult(response: Anthropic.Messages.Message): {
  picks: Array<{ type: "work" | "insight"; id: string }>;
  reason: string;
} | null {
  const block = response.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;
  const input = block.input as {
    picks?: Array<{ type?: unknown; id?: unknown }>;
    reason?: unknown;
  };
  if (!Array.isArray(input.picks) || input.picks.length !== 4) return null;
  if (typeof input.reason !== "string" || !input.reason.trim()) return null;
  const picks: Array<{ type: "work" | "insight"; id: string }> = [];
  for (const item of input.picks) {
    if (item.type !== "work" && item.type !== "insight") return null;
    if (typeof item.id !== "string" || !item.id.trim()) return null;
    picks.push({ type: item.type, id: item.id.trim() });
  }
  return { picks, reason: input.reason.trim() };
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let workId = "";
  try {
    const body = (await request.json()) as { workId?: unknown };
    workId = typeof body.workId === "string" ? body.workId.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!workId) {
    return NextResponse.json({ error: "invalid_work" }, { status: 400 });
  }

  const apiKey =
    process.env.hubtrendchat_claude?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "api_key_missing" }, { status: 503 });
  }

  const [workRes, worksRes, insightsRes, metaRes] = await Promise.all([
    websiteAdminFetch(`/api/admin/works/${workId}`),
    websiteAdminFetch("/api/admin/search?type=work&published=1&limit=50"),
    websiteAdminFetch("/api/admin/search?type=insight&published=1&limit=50"),
    websiteAdminFetch("/api/admin/meta")
  ]);

  if (workRes.status !== 200) {
    return NextResponse.json({ error: "work_not_found" }, { status: 404 });
  }

  const work = parseWorkDetail(unwrapData(workRes.body));
  if (!work) {
    return NextResponse.json({ error: "work_not_found" }, { status: 404 });
  }

  const workHits = (unwrapData<SearchHit[]>(worksRes.body) ?? []).filter(
    (hit) => hit.type === "work" && hit.id !== work.id && hit.status === "published"
  );
  const insightHits = (unwrapData<SearchHit[]>(insightsRes.body) ?? []).filter(
    (hit) => hit.type === "insight" && hit.status === "published"
  );
  const candidates = [...workHits, ...insightHits];
  if (candidates.length < 4) {
    return NextResponse.json({ error: "not_enough_candidates" }, { status: 502 });
  }

  const byKey = new Map(candidates.map((hit) => [`${hit.type}:${hit.id}`, hit]));
  const meta = unwrapData<{
    workCategories?: Array<{ id: string; label?: { ko?: string; en?: string } }>;
  }>(metaRes.body);
  const catNames = new Map(
    (meta?.workCategories ?? []).map((cat) => [
      cat.id,
      cat.label?.ko?.trim() || cat.label?.en?.trim() || cat.id
    ])
  );
  const fields = (work.work_categories_map ?? [])
    .map((item) => catNames.get(item.category_id) ?? item.category_id)
    .filter(Boolean);
  const tags = (work.work_tags ?? []).map(tagLabel).filter(Boolean);

  const candidateLines = candidates
    .slice(0, 80)
    .map((hit) => {
      const title = hitTitle(hit);
      const kind = hit.type === "work" ? "워크" : "인사이트";
      return `- ${kind} id=${hit.id} · ${title}${hit.category ? ` · ${hit.category}` : ""}${
        hit.year ? ` · ${hit.year}` : ""
      }`;
    })
    .join("\n");

  const prompt = [
    "홈페이지 워크 상세 하단 Related Articles에 넣을 공개 콘텐츠 4개를 고르세요.",
    "후보는 아래 목록에만 있습니다. 목록에 없는 id는 쓰지 마세요.",
    "자기 자신 워크는 빼세요. 워크와 인사이트를 섞는 것이 좋습니다.",
    "같은 사업분야만 고르지 마세요.",
    "",
    "이 워크:",
    `제목: ${locLine(work.title)}`,
    `한 줄 요약: ${locLine(work.summary)}`,
    `사업분야: ${fields.join(" · ") || "없음"}`,
    `태그: ${tags.join(" · ") || "없음"}`,
    "본문:",
    bodyText(work) || "없음",
    "",
    "후보:",
    candidateLines
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: "tool", name: "related_recommend" },
      messages: [{ role: "user", content: prompt }]
    });

    const parsed = parseToolResult(response);
    if (!parsed) {
      return NextResponse.json({ error: "parse_failed" }, { status: 502 });
    }

    const picks: SearchHit[] = [];
    const seen = new Set<string>();
    for (const item of parsed.picks) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) {
        return NextResponse.json({ error: "duplicate_pick" }, { status: 502 });
      }
      const hit = byKey.get(key);
      if (!hit) {
        return NextResponse.json({ error: "unknown_pick" }, { status: 502 });
      }
      seen.add(key);
      picks.push(hit);
    }

    if (picks.length !== 4) {
      return NextResponse.json({ error: "incomplete_picks" }, { status: 502 });
    }

    return NextResponse.json({ data: { picks, reason: parsed.reason } });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "luna_failed";
    console.error("[website/luna/related-recommend]", message);
    return NextResponse.json({ error: "luna_failed" }, { status: 502 });
  }
}
