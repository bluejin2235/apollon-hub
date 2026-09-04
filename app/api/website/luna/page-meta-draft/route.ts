import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth/get-api-user";
import { websiteAdminFetch } from "@/lib/website/client";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let key = "";
  try {
    const body = (await request.json()) as { key?: string };
    key = typeof body.key === "string" ? body.key : "";
  } catch {
    key = "";
  }

  if (!key) {
    return NextResponse.json(
      { data: { ko: "", en: "" }, error: "invalid_key", reason: "페이지 키가 없습니다" },
      { status: 400 }
    );
  }

  const source = await websiteAdminFetch("/api/admin/page-meta/draft-source", {
    method: "POST",
    body: JSON.stringify({ key })
  });

  const sourceBody =
    source.body && typeof source.body === "object"
      ? (source.body as Record<string, unknown>)
      : null;
  const sourceData =
    sourceBody && sourceBody.data && typeof sourceBody.data === "object"
      ? (sourceBody.data as { content?: { ko?: string; en?: string } })
      : null;

  if (source.status >= 400 || !sourceData?.content) {
    return NextResponse.json({
      data: { ko: "", en: "" },
      error: "draft_source_failed",
      reason: "페이지 내용을 읽지 못했습니다"
    });
  }

  const apiKey = process.env.hubtrendchat_claude?.trim();
  if (!apiKey) {
    return NextResponse.json({
      data: { ko: "", en: "" },
      error: "no_api_key",
      reason: "루나 API 키가 없습니다"
    });
  }

  const koSrc = (sourceData.content.ko ?? "").trim();
  const enSrc = (sourceData.content.en ?? "").trim();
  if (!koSrc && !enSrc) {
    return NextResponse.json({
      data: { ko: "", en: "" },
      error: "empty_source",
      reason: "이 페이지에서 읽을 내용이 없습니다"
    });
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            "아폴론이머시브웍스 홈페이지 페이지용 AI 요약 초안을 작성하세요.",
            "사실만. 과장 금지. 국문·영문 각 한 문단.",
            "JSON 만 출력: {\"ko\":\"...\",\"en\":\"...\"}",
            `페이지 키: ${key}`,
            "국문 원문:",
            koSrc || "(없음)",
            "영문 원문:",
            enSrc || "(없음)"
          ].join("\n")
        }
      ]
    });

    const text = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({
        data: { ko: "", en: "" },
        error: "parse_failed",
        reason: "루나 응답을 해석하지 못했습니다"
      });
    }

    const parsed = JSON.parse(match[0]) as { ko?: string; en?: string };
    return NextResponse.json({
      data: {
        ko: typeof parsed.ko === "string" ? parsed.ko.trim() : "",
        en: typeof parsed.en === "string" ? parsed.en.trim() : ""
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "루나 호출에 실패했습니다";
    return NextResponse.json({
      data: { ko: "", en: "" },
      error: "luna_failed",
      reason
    });
  }
}
