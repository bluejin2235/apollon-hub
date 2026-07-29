import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { resolveLunaSystemPrompt } from "@/lib/research/luna-system-prompt";
import { extractSnsUrl, SNS_LUNA_REPLY } from "@/lib/research/sns-link";
import { extractFirstUrl, extractVimeoId, extractYoutubeId } from "@/lib/research/types";

export const runtime = "nodejs";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_MODEL = "gemini-2.5-flash";
const YOUTUBE_NO_TRANSCRIPT_MESSAGE =
  "자막이 없어 직접 분석이 어렵습니다. 영상 내용을 텍스트로 알려주시면 분석해 드릴게요.";
const VIMEO_NO_TRANSCRIPT_MESSAGE =
  "Vimeo 영상의 자막이 없어 직접 분석이 어렵습니다. 영상 내용을 텍스트로 알려주시면 분석해 드릴게요.";

type ChatRequestBody = {
  room_id: string;
  message_id: string;
  content: string;
  message_type: string;
  metadata?: Record<string, unknown> | null;
  isSnsLink?: boolean;
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

function getVimeoId(metadata: Record<string, unknown> | null | undefined, content: string): string | null {
  return (
    getMetadataString(metadata, "vimeo_id") ??
    getMetadataString(metadata, "vimeoId") ??
    extractVimeoId(getMetadataString(metadata, "url") ?? content)
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

async function callClaudeText(prompt: string, systemPrompt: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1_500,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }]
  });

  const text = message.content.find((part) => part.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  return text;
}

type ClaudeContentBlock = Anthropic.Messages.ContentBlockParam;

async function callClaudeWithBlocks(blocks: ClaudeContentBlock[], systemPrompt: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error("Claude API key is not configured");
  }

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1_500,
    system: systemPrompt,
    messages: [{ role: "user", content: blocks }]
  });

  const text = message.content.find((part) => part.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Claude returned an empty response");
  }

  return text;
}

async function callGeminiYoutube(prompt: string, youtubeUrl: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.hubtrendchat_geminai;
  if (!apiKey) throw new Error("Gemini API key not configured");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } }
        ]
      }
    ],
    config: { systemInstruction: systemPrompt }
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

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
  youtubeUrl: string,
  systemPrompt: string
): Promise<{ content: string; ai_model: string }> {
  const prompt = `${basePrompt}

유튜브 영상 ID: ${youtubeId}
영상 링크: ${youtubeUrl}

이 유튜브 영상을 분석해줘.`;

  try {
    const content = await callGeminiYoutube(prompt, youtubeUrl, systemPrompt);
    return { content, ai_model: GEMINI_MODEL };
  } catch (error) {
    console.error("[research/chat] Gemini failed, falling back to transcript + Claude", error);
  }

  const transcript = await fetchYoutubeTranscriptText(youtubeId);
  if (transcript) {
    const transcriptPrompt = `${prompt}

유튜브 자막:
${transcript.slice(0, 12_000)}`;
    const content = await callClaudeText(transcriptPrompt, systemPrompt);
    return { content, ai_model: "youtube-transcript + claude-sonnet-4-6" };
  }

  return { content: YOUTUBE_NO_TRANSCRIPT_MESSAGE, ai_model: CLAUDE_MODEL };
}

type VimeoTextTrack = {
  language?: string;
  link?: string;
};

function parseVttToPlainText(vtt: string): string | null {
  const lines = vtt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === "WEBVTT" || line.startsWith("NOTE")) return false;
      if (/^\d+$/.test(line)) return false;
      if (/^\d{2}:\d{2}/.test(line)) return false;
      return true;
    });

  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  return text || null;
}

async function fetchVimeoTranscriptText(videoId: string): Promise<string | null> {
  const token = process.env.VIMEO_ACCESS_TOKEN;
  if (!token) {
    console.error("[research/chat] VIMEO_ACCESS_TOKEN not configured");
    return null;
  }

  try {
    const response = await fetch(`https://api.vimeo.com/videos/${videoId}/texttracks`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.vimeo.*+json;version=3.4"
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      console.error("[research/chat] vimeo texttracks failed", response.status);
      return null;
    }

    const payload = (await response.json()) as { data?: VimeoTextTrack[] };
    const tracks = payload.data ?? [];
    if (tracks.length === 0) return null;

    const byLanguage = (prefix: string) =>
      tracks.find((track) => track.language?.toLowerCase().startsWith(prefix));

    const track = byLanguage("ko") ?? byLanguage("en") ?? tracks[0];
    const trackUrl = track?.link;
    if (!trackUrl) return null;

    const vttResponse = await fetch(trackUrl, { signal: AbortSignal.timeout(15_000) });
    if (!vttResponse.ok) return null;

    const vtt = await vttResponse.text();
    return parseVttToPlainText(vtt);
  } catch (error) {
    console.error("[research/chat] vimeo transcript fetch failed", error);
    return null;
  }
}

async function analyzeVimeoReply(
  basePrompt: string,
  vimeoId: string,
  vimeoUrl: string,
  systemPrompt: string
): Promise<{ content: string; ai_model: string }> {
  const prompt = `${basePrompt}

Vimeo 영상 ID: ${vimeoId}
영상 링크: ${vimeoUrl}

이 Vimeo 영상을 분석해줘.`;

  const transcript = await fetchVimeoTranscriptText(vimeoId);
  if (transcript) {
    const transcriptPrompt = `${prompt}

Vimeo 자막:
${transcript.slice(0, 12_000)}`;
    const content = await callClaudeText(transcriptPrompt, systemPrompt);
    return { content, ai_model: "vimeo + claude-sonnet-4-6" };
  }

  return { content: VIMEO_NO_TRANSCRIPT_MESSAGE, ai_model: CLAUDE_MODEL };
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
  body: ChatRequestBody,
  systemPrompt: string
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

    return analyzeYoutubeReply(basePrompt, youtubeId, youtubeUrl, systemPrompt);
  }

  if (body.message_type === "vimeo") {
    const vimeoId = getVimeoId(metadata, body.content);
    if (!vimeoId) {
      throw new Error("Vimeo ID를 찾을 수 없습니다.");
    }

    const vimeoUrl = getMetadataString(metadata, "url") ?? `https://vimeo.com/${vimeoId}`;

    return analyzeVimeoReply(basePrompt, vimeoId, vimeoUrl, systemPrompt);
  }

  if (body.message_type === "link") {
    const url = getMetadataString(metadata, "url") ?? body.content;
    const pageText = await fetchUrlText(url);
    const prompt = `${basePrompt}

링크 URL: ${url}

페이지 내용 요약:
${pageText}`;

    const content = await callClaudeText(prompt, systemPrompt);
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
    ], systemPrompt);
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
    ], systemPrompt);
    return { content, ai_model: CLAUDE_MODEL };
  }

  const content = await callClaudeText(basePrompt, systemPrompt);
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

    const isSnsLink = body.isSnsLink === true;

    const lunaReply = isSnsLink
      ? {
          content: SNS_LUNA_REPLY,
          ai_model: "sns-guidance"
        }
      : await generateLunaReply(
          recentContext,
          {
            ...body,
            room_id: roomId,
            message_id: messageId,
            content
          },
          await resolveLunaSystemPrompt(admin)
        );

    const snsUrl = isSnsLink
      ? extractSnsUrl(content) ??
        getMetadataString(body.metadata ?? null, "url") ??
        extractFirstUrl(content) ??
        content
      : null;

    const { data: aiMessage, error: insertMessageError } = await admin
      .from("trend_messages")
      .insert({
        room_id: roomId,
        profile_id: null,
        content: lunaReply.content,
        message_type: "ai",
        metadata: isSnsLink
          ? {
              ai_model: lunaReply.ai_model,
              is_sns_guidance: true,
              sns_url: snsUrl,
              trigger_message_id: messageId
            }
          : { ai_model: lunaReply.ai_model }
      })
      .select("id")
      .single();

    if (insertMessageError || !aiMessage) {
      console.error("[research/chat] ai message insert failed", insertMessageError);
      return NextResponse.json({ error: insertMessageError?.message ?? "Failed to save AI message" }, { status: 500 });
    }

    if (!isSnsLink) {
      const analysis = buildAnalysisFields(lunaReply.content);

      const { error: analysisError } = await admin.from("trend_analyses").insert({
        message_id: aiMessage.id,
        summary: analysis.summary,
        keywords: analysis.keywords,
        relevance_score: null,
        apollon_insight: analysis.apollon_insight
      });

      if (analysisError) {
        console.error("[research/chat] analysis insert failed", analysisError);
        return NextResponse.json({ error: analysisError.message }, { status: 500 });
      }

      const { error: metadataError } = await admin
        .from("trend_messages")
        .update({
          metadata: { ai_model: lunaReply.ai_model, has_analysis: true }
        })
        .eq("id", aiMessage.id);

      if (metadataError) {
        console.error("[research/chat] has_analysis metadata update failed", metadataError);
      }
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
