/**
 * 대화 제목 생성 1건 검증
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-conversation-title.ts [conversationId]
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient } from "@supabase/supabase-js";
import { maybeGenerateConversationTitle } from "../lib/luna/conversation-title";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env missing");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let id = process.argv[2]?.trim();
  if (!id) {
    const { data } = await admin
      .from("luna_conversations")
      .select("id, title")
      .eq("title", "새 대화")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    id = data?.id;
  }
  if (!id) {
    console.log("no untitled conversation");
    return;
  }

  const t0 = Date.now();
  const title = await maybeGenerateConversationTitle(admin, id);
  console.log({
    id,
    title,
    ms: Date.now() - t0
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
