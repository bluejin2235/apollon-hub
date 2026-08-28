import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { createQueryEmbedding } from "../lib/luna/embedding";
import {
  hasImageSearchIntent,
  matchMediaEmbeddings,
  MEDIA_MATCH_THRESHOLD
} from "../lib/luna/media-index-search";

const QUESTIONS = [
  "더후 글로벌 론칭 KV 이미지 보여줘",
  "로비 미디어아rt 레퍼런스"
].map((q) => q.replace("미디어아rt", "미디어아rt"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing env");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  for (const q of [
    "더후 글로벌 론칭 KV 이미지 보여줘",
    "로비 미디어아rt 레퍼런스".replace("미디어아rt", "미디어아트")
  ]) {
    console.log(`\nQ: ${q}`);
    console.log(`  imageIntent: ${hasImageSearchIntent(q)}`);
    const t0 = Date.now();
    const emb = await createQueryEmbedding(q);
    const embMs = Date.now() - t0;
    if (!emb) {
      console.log("  embedding: FAIL");
      continue;
    }
    const t1 = Date.now();
    const all = await matchMediaEmbeddings(admin, emb, {
      threshold: 0,
      limit: 10
    });
    const searchMs = Date.now() - t1;
    const above = all.filter((h) => h.similarity >= MEDIA_MATCH_THRESHOLD);
    console.log(`  embed=${embMs}ms search=${searchMs}ms total=${all.length} above=${above.length}`);
    for (const h of all.slice(0, 5)) {
      console.log(
        `    ${h.similarity.toFixed(3)} ${h.ai_category ?? "?"} ${h.file_name} | ${h.project ?? ""}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
