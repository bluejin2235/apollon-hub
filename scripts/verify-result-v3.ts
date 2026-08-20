/**
 * 답변 화면 3층 + 검색 경로 시간 검증
 * 실행: npx tsx scripts/verify-result-v3.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { retrieveKnowledgeEmbeddings } from "../lib/luna/embedding-retrieve";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import {
  buildSourcePacks,
  takeTopNotionSourcesForLlm,
  tierSourcePacks
} from "../lib/luna/source-pack";
import type { LunaCard } from "../lib/luna/tavily";
import { searchNasLegacy } from "../lib/luna/workserver";
import { matchWikiSections } from "../lib/luna/wiki-match";
import { loadWikiDocs } from "../lib/wiki/store";

function nasToCards(
  rows: { drive: string | null; path: string; type: string | null; file_summary: string | null }[]
): LunaCard[] {
  return rows.map((row) => {
    const name = row.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || row.path;
    const isFile = (row.type ?? "").toLowerCase() === "file" || /\.[a-z0-9]{1,8}$/i.test(name);
    return {
      type: "nas" as const,
      title: name,
      url: null,
      thumbnail: null,
      description: row.file_summary || row.path,
      drive: row.drive?.trim() || undefined,
      raw_path: row.path,
      is_file: isFile
    };
  });
}

function printTiers(
  label: string,
  ms: number,
  notionN: number,
  nasN: number,
  wikiN: number,
  llmN: number,
  tiers: ReturnType<typeof tierSourcePacks>
) {
  const rec = tiers.recommended;
  console.log(`Q: ${label}`);
  console.log(`  search ${ms}ms  notion ${notionN}  nas ${nasN}  wiki ${wikiN}  llm-top ${llmN}`);
  console.log(
    `  max=${tiers.maxScore.toFixed(2)}  low=${tiers.lowConfidence ? "yes" : "no"}  rec=${rec ? `${rec.title} (${rec.score.toFixed(2)} · ${rec.onlySide ?? "묶음"})` : "-"}  mid=${tiers.mid.length}  weak=${tiers.weak.length}`
  );
  if (rec?.onlySide === "nas") console.log("  → 노션 기록 없음");
  if (rec?.onlySide === "notion") console.log("  → Work서버 폴더 없음");
  if (tiers.lowConfidence) console.log("  → 추천 자료 없음 (간략 카드만)");
  for (const m of tiers.mid) {
    console.log(`    mid  ${m.score.toFixed(2)}  ${m.title}`);
  }
  console.log("");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing supabase env");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("=== Result v3 search+tier verification ===\n");

  const findQs = [
    "롯데타워 1차 아이데이션 자료 찾아줘",
    "인스파이어 시즌3 수행계획서 어디 있어",
    "WTCS 무역센터 건 어떻게 돼가",
    "작년 미디어파사드 자료 모아줘"
  ];

  for (const q of findQs) {
    const t0 = Date.now();
    const [notion, nas] = await Promise.all([
      searchNotionForLuna(admin, q.slice(0, 80), q),
      searchNasLegacy(admin, q.slice(0, 80), q)
    ]);
    const ms = Date.now() - t0;
    const cards = nasToCards(nas);
    const views = buildSourcePacks(notion.sources, cards);
    const tiers = tierSourcePacks(views);
    const llmN = takeTopNotionSourcesForLlm(notion.sources).length;
    printTiers(q, ms, notion.sources.length, nas.length, 0, llmN, tiers);
  }

  {
    const q = "병가 며칠 쓸 수 있어";
    const t0 = Date.now();
    const [wikiBundle, emb] = await Promise.all([
      loadWikiDocs(admin, { activeOnly: true }),
      retrieveKnowledgeEmbeddings(admin, q)
    ]);
    const wiki = matchWikiSections(wikiBundle.items, [q], q, emb.wiki);
    const ms = Date.now() - t0;
    console.log(`Q: ${q}`);
    console.log(`  wiki-match ${ms}ms  sections ${wiki.length}`);
    for (const s of wiki.slice(0, 3)) {
      console.log(`    - ${s.title} · ${s.section_title} (${s.score.toFixed(2)})`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
