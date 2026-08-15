import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bumpUsageDaily,
  getTierModel,
  readUsage,
  resolveAnthropicModel
} from "@/lib/luna/engine";

const TITLE_SYSTEM = `대화 내용을 보고 짧은 제목을 만드세요.
15자 이내. 명사형으로 끝냅니다.
따옴표나 마침표를 붙이지 마세요.
제목만 응답하고 다른 말을 하지 마세요.
예시: 인스파이어 시즌3 착수보고 / 해운대 명소화 검토 / 미디어파사드 레퍼런스`;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function sanitizeTitle(raw: string): string {
  let t = raw.trim().replace(/^["'「『]|["'」』]$/g, "").trim();
  t = t.replace(/[。.]$/u, "").trim();
  if (t.length > 20) t = t.slice(0, 20);
  return t;
}

/**
 * title 이 '새 대화'이고 메시지 2개 이상이면 B등급으로 제목 생성 후 UPDATE.
 * 실패해도 throw 하지 않음.
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

    const { count, error: countError } = await admin
      .from("luna_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);

    if (countError || (count ?? 0) < 2) return null;

    const [{ data: userMsg }, { data: assistantMsg }] = await Promise.all([
      admin
        .from("luna_messages")
        .select("content")
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("luna_messages")
        .select("content")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    ]);

    const userText =
      typeof userMsg?.content === "string" ? userMsg.content.trim() : "";
    const assistantText =
      typeof assistantMsg?.content === "string"
        ? assistantMsg.content.trim()
        : "";
    if (!userText && !assistantText) return null;

    const client = getAnthropicClient();
    if (!client) return null;

    const tierBCfg = await getTierModel(admin, "B");
    const tierB = resolveAnthropicModel(tierBCfg);

    const res = await client.messages.create({
      model: tierB.model_id,
      max_tokens: 32,
      system: TITLE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `사용자: ${userText.slice(0, 400)}\n\n답변: ${assistantText.slice(0, 600)}`
        }
      ]
    });

    bumpUsageDaily(admin, {
      tier: "B",
      model_id: tierB.model_id,
      usage: readUsage(res.usage)
    });

    const raw =
      res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const title = sanitizeTitle(raw);
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

/** fire-and-forget 래퍼 */
export function scheduleConversationTitle(
  admin: SupabaseClient,
  conversationId: string
): void {
  void maybeGenerateConversationTitle(admin, conversationId);
}
