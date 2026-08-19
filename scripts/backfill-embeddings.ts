/**
 * 최초·누락 임베딩 생성. 실행은 블루진.
 *
 *   npx tsx scripts/backfill-embeddings.ts
 *   npx tsx scripts/backfill-embeddings.ts --limit=200
 *
 * 전제: supabase/migrations/luna_search_embeddings.sql 적용 + LUNA_OPENAI_API_KEY
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { backfillMissingEmbeddings } from "../lib/luna/embedding-store";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 필요");
    process.exit(1);
  }
  if (!process.env.LUNA_OPENAI_API_KEY?.trim()) {
    console.error("LUNA_OPENAI_API_KEY 필요");
    process.exit(1);
  }

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limitPerKind = limitArg ? Number(limitArg.split("=")[1]) : 500;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("[backfill-embeddings] start", { limitPerKind });
  const result = await backfillMissingEmbeddings(admin, {
    limitPerKind: Number.isFinite(limitPerKind) ? limitPerKind : 500
  });
  console.log("[backfill-embeddings] done", result);
  if (result.schema_missing) {
    console.error(
      "스키마 없음 — supabase/migrations/luna_search_embeddings.sql 을 먼저 적용하세요."
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
