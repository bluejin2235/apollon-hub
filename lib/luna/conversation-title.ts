import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lunaLlmComplete } from "@/lib/luna/llm/client";

const TITLE_SYSTEM = `대화 내용을 보고 짧은 제목을 만드세요.
8~15자. 명사형으로 끝냅니다.
따옴표나 마침표를 붙이지 마세요.
제목만 응답하고 다른 말을 하지 마세요.
예시: 인스파이어 시즌3 착수 / 해운대 명소화 검토 / 미디어파사드 레퍼런스`;

function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^["'`「『""]+/u, "").replace(/["'`」』""]+$/u, "").trim();
  t = t.replace(/[。.?!？！]+$/u, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 15) t = t.slice(0, 15).trim();
  return t;
}

/** LLM 실패 시 첫 질문에서 8~15자 후보 */
function heuristicTitle(userText: string): string | null {
  const cleaned = userText
    .replace(/\s+/g, " ")
    .replace(/[?？!！.。]+$/g, "")
    .trim();
  if (cleaned.length < 2) return null;
  if (cleaned.length <= 15) return cleaned;
  const cut = cleaned.slice(0, 15);
  const sp = cut.lastIndexOf(" ");
  if (sp >= 8) return cut.slice(0, sp);
  return cut;
}

/**
 * title 이 '새 대화'이면 B등급으로 제목 생성 후 UPDATE.
 * 첫 사용자 메시지만 있어도 동작. 실패해도 throw 하지 않음.
 */
export async function maybeGenerateConversationTitle(
  admin: SupabaseClient,
  conversationId: string
): Promise<string | null> {
  try {
    const { data: conv, error: convError } = await admin
      .from("luna_conversations")
      .select("id, title")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError || !conv) return null;
    if ((conv.title ?? "").trim() !== "새 대화") return null;

    const { data: userMsg, error: userErr } = await admin
      .from("luna_messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (userErr) return null;
    const userText =
      typeof userMsg?.content === "string" ? userMsg.content.trim() : "";
    if (!userText) return null;

    const { data: assistantMsg } = await admin
      .from("luna_messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const assistantText =
      typeof assistantMsg?.content === "string"
        ? assistantMsg.content.trim()
        : "";

    let title: string | null = null;
    try {
      const prompt = assistantText
        ? `사용자: ${userText.slice(0, 400)}\n\n답변: ${assistantText.slice(0, 400)}`
        : `사용자: ${userText.slice(0, 400)}`;
      const result = await lunaLlmComplete(admin, {
        tier: "B",
        feature: "title",
        system: TITLE_SYSTEM,
        user: prompt,
        maxTokens: 32
      });
      title = sanitizeTitle(result.text);
    } catch (err) {
      console.error("[luna/title] llm", err);
    }

    if (!title) {
      title = heuristicTitle(userText);
    }
    if (!title) return null;

    const { error: updateError } = await admin
      .from("luna_conversations")
      .update({
        title,
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId)
      .eq("title", "새 대화");

    if (updateError) {
      console.error("[luna/title] update", updateError);
      return null;
    }

    console.log("[luna/title] generated", conversationId, title);
    return title;
  } catch (err) {
    console.error("[luna/title] generate", err);
    return null;
  }
}

/** fire-and-forget 래퍼 (서버리스에서는 클라이언트의 /title 호출이 더 안전) */
export function scheduleConversationTitle(
  admin: SupabaseClient,
  conversationId: string
): void {
  void maybeGenerateConversationTitle(admin, conversationId);
}
