import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";
export const maxDuration = 30;

const MODEL = "claude-sonnet-4-6";
const SLUG_MAX = 80;

const SLUG_TOOL: Anthropic.Messages.Tool = {
  name: "insight_slug",
  description: "인사이트 글의 영문 URL 주소",
  input_schema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          "영문 소문자와 하이픈만. 제목의 뜻을 담은 짧은 주소. 예: hyundai-futurenet-apollon-media-architecture-mou"
      }
    },
    required: ["slug"]
  }
};

function readTitle(body: unknown): { ko: string; en: string } {
  if (!body || typeof body !== "object") return { ko: "", en: "" };
  const rec = body as Record<string, unknown>;
  const title = rec.title;
  if (title && typeof title === "object" && !Array.isArray(title)) {
    const loc = title as Record<string, unknown>;
    return {
      ko: typeof loc.ko === "string" ? loc.ko.trim() : "",
      en: typeof loc.en === "string" ? loc.en.trim() : ""
    };
  }
  return {
    ko: typeof rec.titleKo === "string" ? rec.titleKo.trim() : "",
    en: typeof rec.titleEn === "string" ? rec.titleEn.trim() : ""
  };
}

function sanitizeInsightSlug(raw: string): string {
  const lowered = raw
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return lowered.slice(0, SLUG_MAX).replace(/-$/, "");
}

function parseToolSlug(response: Anthropic.Messages.Message): string | null {
  for (const part of response.content) {
    if (part.type !== "tool_use" || part.name !== "insight_slug") continue;
    const input = part.input;
    if (!input || typeof input !== "object") continue;
    const slug = (input as { slug?: unknown }).slug;
    if (typeof slug !== "string") continue;
    const clean = sanitizeInsightSlug(slug);
    if (clean) return clean;
  }
  return null;
}

function fail(error: string, status: number, reason: string) {
  return NextResponse.json({ error, reason }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return fail("unauthorized", 401, "로그인이 필요합니다");
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_json", 400, "요청을 읽지 못했습니다");
  }

  const title = readTitle(body);
  if (!title.ko && !title.en) {
    return fail("missing_title", 400, "제목이 비어 있습니다");
  }

  const apiKey =
    process.env.hubtrendchat_claude?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return fail("api_key_missing", 503, "루나 키가 없습니다");
  }

  const prompt = [
    "홈페이지 인사이트 글의 영문 URL 주소를 만드세요.",
    "영문 소문자와 하이픈만 씁니다. 검색에 유리하게 제목의 뜻을 담습니다.",
    "국문 제목만 있어도 영문으로 옮깁니다.",
    "회사 이름·고유명사는 음차를 유지합니다. 불필요한 관사·접속사는 빼세요.",
    "너무 길지 않게, 핵심 단어 위주로.",
    "",
    `국문 제목: ${title.ko || "(없음)"}`,
    `영문 제목: ${title.en || "(없음)"}`
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      tools: [SLUG_TOOL],
      tool_choice: { type: "tool", name: "insight_slug" },
      messages: [{ role: "user", content: prompt }]
    });

    const slug = parseToolSlug(response);
    if (!slug) {
      return fail("parse_failed", 502, "주소를 만들지 못했습니다");
    }

    return NextResponse.json({ data: { slug } });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "luna_failed";
    console.error("[website/luna/insight-slug]", message);
    return fail("luna_failed", 502, message);
  }
}
