import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";
import { fallbackChangeNote } from "@/lib/website/publish";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

function readChangedFields(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as Record<string, unknown>).changedFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * 공개 팝업용 한 줄 요약. 바뀐 칸 이름만 넘깁니다.
 * 실패해도 fallback 문장을 돌려 팝업이 멈추지 않게 합니다.
 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const changedFields = readChangedFields(body);
  const fallback = fallbackChangeNote(changedFields);

  const apiKey = process.env.hubtrendchat_claude?.trim();
  if (!apiKey || changedFields.length === 0) {
    return NextResponse.json({ data: { note: fallback, source: "fallback" } });
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: [
            "홈페이지 워크를 공개할 때 남기는 변경 요약문을 한국어 한 문장으로 써 주세요.",
            "친절하고 간결하게. 80자 이내.",
            "바뀐 항목:",
            changedFields.map((field) => `- ${field}`).join("\n"),
            "문장만 출력하세요.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();

    return NextResponse.json({
      data: { note: text || fallback, source: text ? "luna" : "fallback" },
    });
  } catch {
    return NextResponse.json({ data: { note: fallback, source: "fallback" } });
  }
}
