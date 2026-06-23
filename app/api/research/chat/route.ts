import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { extractYoutubeId } from "@/lib/research/types";

export const runtime = "nodejs";

const LUNA_SYSTEM_PROMPT = `너는 아폴론이머시브웍스의 AI 직원 루나(Luna)야.
아폴론은 미디어 아키텍처 전문 스튜디오로 'We Make Beloved Digital Landmarks'가 미션이야.
팀원들이 공유하는 트렌드, 링크, 영상, 이미지를 분석해서
공간 경험 / 리테일·전시·랜드마크 적용 가능성 / 아폴론 관점 인사이트를 제공해.
답변은 간결하게 하고, 마지막에 핵심 키워드 3~5개도 제시해줘.
키워드 형식: [키워드1, 키워드2, 키워드3]
답변은 반드시 3문장 이내로 요약해줘.
줄바꿈 없이 한 문단으로 작성해.
키워드는 마지막에 한 줄로 [키워드1, 키워드2, 키워드3] 형식으로만 추가해.`;

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_MODEL = "gemini-2.5-flash";
const YOUTUBE_NO_TRANSCRIPT_MESSAGE =
  "자막이 없어 직접 분석이 어렵습니다. 영상 내용을 텍스트로 알려주시면 분석해 드릴게요.";

type ChatRequestBody = {
  room_id: string;
  message_id: string;
  content: string;
  message_type: string;
  metadata?: Record<string, unknown> | null;
};

type RecentMessageRow = {
  id: string;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profile_id: string | null;
  profile: { name: string } | { name: string }[] | null;
};

const RECENT_MESSAGE_SELECT = `
  id,
  content,
  message_type,
  metadata,
  created_at,
  profile_id,
  profile:profiles!profile_id (name)
`;

function profileName(row: RecentMessageRow): string {
  const raw = row.profile;
  if (!raw) return row.profile_id ? "팀원" : "루나 (Luna)";
  if (Array.isArray(raw)) return raw[0]?.name?.trim() || "팀원";
  return raw.name?.trim() || "팀원";
}

function formatRecentContext(rows: RecentMessageRow[]): string {
  if (rows.length === 0) return "(이전 대화 없음)";

  return rows
    .map((row) => {
      const label = row.message_type === "ai" ? "루나 (Luna)" : profileName(row);
      return `- ${label}: ${row.content}`;
    })
    .join("\n");
}

function parseKeywords(text: string): string[] {
  const match = text.match(/\[([^\]]+)\]\s*$/);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function stripKeywordLine(text: string): string {
  return text.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

function buildAnalysisFields(aiContent: string) {
  const keywords = parseKeywords(aiContent);
  const body = stripKeywordLine(aiContent);
  const summary = body.split(/\n\n+/)[0]?.slice(0, 300) || body.slice(0, 300);

  return {
    content: aiContent,
    summary,
    keywords,
    apollon_insight: body
  };
}

function getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getYoutubeId(metadata: Record<string, unknown> | null | undefined, content: string): string | null {
  return (
    getMetadataString(metadata, "youtube_id") ??
    getMetadataString(metadata, "youtubeId") ??
    extractYoutubeId(getMetadataString(metadata, "url") ?? content)
  );
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/** ChatGPT fallback — 현재 미사용, 추후 장애 시 전환용 */
async function callChatGptFallback(_prompt: string): Promise<string> {
  const apiKey = process.env.hubtrendchat_chatgpt;
  if (!apiKey) {
    throw new Error("ChatGPT API key is not configured");
  }

  void apiKey;
  throw new Error("ChatGPT fallback is not enabled");
}

async function fetchUrlText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Apollon-Hub-TrendRadar/1.0" }
    });

    if (!response.ok) {
      return `(URL 응답 오류: HTTP ${response.status})`;
    }

    const html = await response.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8_000);
  } catch {
    return `(URL 내용을 가져오지 못했습니다: ${url})`;
  }
}

async function fetchBinaryFromUrl(url: string): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`파일 다운로드 실패: HTTP ${response.status}`);
  }

  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { base64: buffer.toString("base64"), mediaType };
}

async function callClaudeText(prompt: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1_500,
    system: LUNA_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });

  const text = message.content.find((part) => part.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  return text;
}

type ClaudeContentBlock = Anthropic.Messages.ContentBlockParam;

async function callClaudeWithBlocks(blocks: ClaudeContentBlock[]): Promise<string> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1_500,
    system: LUNA_SYSTEM_PROMPT,
    messages: [{ role: "user", content: blocks }]
  });

  const text = message.content.find((part) => part.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  return text;
}

/*
async function callGeminiYoutube(prompt: string, youtubeUrl: string): Promise<string> {
  const apiKey = process.env.hubtrendchat_geminai;
  if (!apiKey) {
    throw new Error("Gemini API key is not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: LUNA_SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { file_data: { mime_type: "video/*", file_uri: youtubeUrl } }]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}
*/

async function fetchYoutubeTranscriptText(videoId: string): Promise<string | null> {
  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    const text = items
      .map((item) => item.text)
      .join(" ")
      .trim();
    return text || null;
  } catch (error) {
    console.error("[research/chat] youtube transcript fetch failed", error);
    return null;
  }
}

async function analyzeYoutubeReply(
  basePrompt: string,
  youtubeId: string,
  youtubeUrl: string
): Promise<{ content: string; ai_model: string }> {
  const prompt = `${basePrompt}

유튜브 영상 ID: ${youtubeId}
영상 링크: ${youtubeUrl}

이 유튜브 영상을 분석해줘.`;

  const transcript = await fetchYoutubeTranscriptText(youtubeId);
  if (transcript) {
    const transcriptPrompt = `${prompt}

유튜브 자막:
${transcript.slice(0, 12_000)}`;
    const content = await callClaudeText(transcriptPrompt);
    return { content, ai_model: "youtube-transcript + claude-sonnet-4-6" };
  }

  return { content: YOUTUBE_NO_TRANSCRIPT_MESSAGE, ai_model: CLAUDE_MODEL };
}

function buildAnalysisPrompt(
  recentContext: string,
  body: ChatRequestBody
): string {
  return `최근 채팅 맥락:
${recentContext}

---
팀원이 방금 공유한 메시지:
유형: ${body.message_type}
내용: ${body.content}`;
}

async function generateLunaReply(
  recentContext: string,
  body: ChatRequestBody
): Promise<{ content: string; ai_model: string }> {
  const basePrompt = buildAnalysisPrompt(recentContext, body);
  const metadata = body.metadata ?? null;

  if (body.message_type === "youtube") {
    const youtubeId = getYoutubeId(metadata, body.content);
    if (!youtubeId) {
      throw new Error("YouTube ID를 찾을 수 없습니다.");
    }

    const youtubeUrl =
      getMetadataString(metadata, "url") ?? `https://www.youtube.com/watch?v=${youtubeId}`;

    return analyzeYoutubeReply(basePrompt, youtubeId, youtubeUrl);
  }

  if (body.message_type === "link") {
    const url = getMetadataString(metadata, "url") ?? body.content;
    const pageText = await fetchUrlText(url);
    const prompt = `${basePrompt}

링크 URL: ${url}

페이지 내용 요약:
${pageText}`;

    const content = await callClaudeText(prompt);
    return { content, ai_model: CLAUDE_MODEL };
  }

  if (body.message_type === "image") {
    const imageUrl = getMetadataString(metadata, "url") ?? getMetadataString(metadata, "imageUrl");
    if (!imageUrl) {
      throw new Error("이미지 URL이 없습니다.");
    }

    const { base64, mediaType } = await fetchBinaryFromUrl(imageUrl);
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const safeMediaType = allowed.includes(mediaType) ? mediaType : "image/jpeg";

    const content = await callClaudeWithBlocks([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: safeMediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64
        }
      },
      {
        type: "text",
        text: `${basePrompt}

첨부된 이미지를 분석해줘.`
      }
    ]);
    return { content, ai_model: CLAUDE_MODEL };
  }

  if (body.message_type === "file") {
    const fileUrl = getMetadataString(metadata, "url");
    const filename = getMetadataString(metadata, "filename") ?? body.content;
    if (!fileUrl) {
      throw new Error("파일 URL이 없습니다.");
    }

    const { base64 } = await fetchBinaryFromUrl(fileUrl);

    const content = await callClaudeWithBlocks([
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64
        }
      },
      {
        type: "text",
        text: `${basePrompt}

첨부된 PDF 파일명: ${filename}

이 문서를 분석해줘.`
      }
    ]);
    return { content, ai_model: CLAUDE_MODEL };
  }

  const content = await callClaudeText(basePrompt);
  return { content, ai_model: CLAUDE_MODEL };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    let body: ChatRequestBody;
    try {
      body = (await request.json()) as ChatRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const roomId = body.room_id?.trim();
    const messageId = body.message_id?.trim();
    const content = body.content?.trim();

    if (!roomId || !messageId || !content || !body.message_type?.trim()) {
      return NextResponse.json(
        { error: "room_id, message_id, content, message_type are required" },
        { status: 400 }
      );
    }

    const { data: room, error: roomError } = await admin
      .from("trend_rooms")
      .select("id")
      .eq("id", roomId)
      .maybeSingle();

    if (roomError) {
      console.error("[research/chat] room lookup failed", roomError);
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const { data: recentRows, error: recentError } = await admin
      .from("trend_messages")
      .select(RECENT_MESSAGE_SELECT)
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentError) {
      console.error("[research/chat] recent messages failed", recentError);
      return NextResponse.json({ error: recentError.message }, { status: 500 });
    }

    const recentContext = formatRecentContext(
      [...(recentRows ?? [])].reverse() as RecentMessageRow[]
    );

    const lunaReply = await generateLunaReply(recentContext, {
      ...body,
      room_id: roomId,
      message_id: messageId,
      content
    });

    const analysis = buildAnalysisFields(lunaReply.content);

    const { data: aiMessage, error: insertMessageError } = await admin
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: null,
        content: analysis.content,
        message_type: "ai",
        metadata: { ai_model: lunaReply.ai_model }
      })
      .select("id")
      .single();

    if (insertMessageError || !aiMessage) {
      console.error("[research/chat] ai message insert failed", insertMessageError);
      return NextResponse.json({ error: insertMessageError?.message ?? "Failed to save AI message" }, { status: 500 });
    }

    const { error: analysisError } = await admin.from("trend_analyses").insert({
      message_id: messageId,
      summary: analysis.summary,
      keywords: analysis.keywords,
      relevance_score: null,
      apollon_insight: analysis.apollon_insight
    });

    if (analysisError) {
      console.error("[research/chat] analysis insert failed", analysisError);
      return NextResponse.json({ error: analysisError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      ai_message_id: aiMessage.id
    });
  } catch (error) {
    console.error("[research/chat]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
