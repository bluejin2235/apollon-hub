/**
 * 재색인 없이 기존 luna_notion_blocks 로 heading 청킹 미리보기.
 *
 *   npx tsx scripts/dry-run-notion-chunks.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import {
  buildNotionChunks,
  NOTION_CHUNK_MAX_CHARS,
  NOTION_CHUNK_MIN_BODY_CHARS,
  NOTION_CHUNK_MIN_CHARS
} from "@/lib/luna/notion-chunk";
import { estimateEmbeddingCostUsd } from "@/lib/luna/notion-index";

const PAGE_TITLE_HINT = "롯데타워";
const PAGE_TITLE_HINT2 = "1st Ideation";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 필요");
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: pages, error: pageErr } = await admin
    .from("luna_notion_pages")
    .select("page_id, title")
    .ilike("title", `%${PAGE_TITLE_HINT}%`)
    .limit(40);
  if (pageErr) throw pageErr;

  const target =
    (pages ?? []).find(
      (p) =>
        String(p.title).includes(PAGE_TITLE_HINT) &&
        String(p.title).includes(PAGE_TITLE_HINT2)
    ) ??
    (pages ?? []).find((p) => String(p.title).includes("Ideation")) ??
    null;

  if (!target) {
    console.log("롯데타워 Ideation 페이지를 찾지 못함. 후보:");
    for (const p of pages ?? []) console.log(" -", p.title);
    process.exit(1);
  }

  const { data: blocks, error: blockErr } = await admin
    .from("luna_notion_blocks")
    .select("block_id, page_id, block_type, text, position")
    .eq("page_id", target.page_id)
    .order("position");
  if (blockErr) throw blockErr;

  const indexed = (blocks ?? []).map((b) => ({
    block_id: String(b.block_id),
    page_id: String(b.page_id),
    block_type: String(b.block_type ?? "unknown"),
    text: String(b.text ?? ""),
    position: Number(b.position) || 0,
    content_hash: ""
  }));

  const lotte = buildNotionChunks(target.page_id, indexed, {
    minChars: NOTION_CHUNK_MIN_CHARS,
    maxChars: NOTION_CHUNK_MAX_CHARS,
    minBodyChars: NOTION_CHUNK_MIN_BODY_CHARS,
    pageTitle: String(target.title)
  });

  console.log("\n=== 1. 롯데타워 1st Ideation ===");
  console.log(`title: ${target.title}`);
  console.log(`page_id: ${target.page_id}`);
  console.log(`blocks: ${indexed.length} → chunks: ${lotte.chunks.length}`);
  console.log(`skippedThin (이 페이지): ${lotte.skippedThin}`);
  console.log("\n--- 청크 목록 ---");
  for (const c of lotte.chunks) {
    console.log(
      `[${c.position}] chars=${c.text.length} heading=${JSON.stringify(c.heading)}`
    );
    console.log(c.text);
    console.log("---");
  }

  console.log("\n=== 전체 스캔 ===");
  const pageTitleById = new Map<string, string>();
  {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("luna_notion_pages")
        .select("page_id, title")
        .eq("archived", false)
        .order("page_id")
        .range(from, from + 999);
      if (error) throw error;
      const rows = data ?? [];
      for (const r of rows) {
        pageTitleById.set(String(r.page_id), String(r.title ?? ""));
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  type Acc = {
    rows: Array<{
      block_id: string;
      page_id: string;
      block_type: string;
      text: string;
      position: number;
      content_hash: string;
    }>;
    hasHeading: boolean;
  };
  const byPage = new Map<string, Acc>();
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("luna_notion_blocks")
      .select("block_id, page_id, block_type, text, position")
      .order("page_id")
      .order("position")
      .range(from, from + 999);
    if (error) throw error;
    const rows = data ?? [];
    for (const b of rows) {
      const pageId = String(b.page_id);
      if (!pageTitleById.has(pageId)) continue;
      let acc = byPage.get(pageId);
      if (!acc) {
        acc = { rows: [], hasHeading: false };
        byPage.set(pageId, acc);
      }
      const block_type = String(b.block_type ?? "unknown");
      if (["heading_1", "heading_2", "heading_3"].includes(block_type)) {
        acc.hasHeading = true;
      }
      acc.rows.push({
        block_id: String(b.block_id),
        page_id: pageId,
        block_type,
        text: String(b.text ?? ""),
        position: Number(b.position) || 0,
        content_hash: ""
      });
    }
    if (rows.length < 1000) break;
    from += 1000;
    if (from % 10000 === 0) {
      process.stderr.write(`loaded blocks=${from}\n`);
    }
  }

  let totalChunksEst = 0;
  let totalSkippedThin = 0;
  let totalChars = 0;
  const noHeadingSamples: Array<{
    title: string;
    chunks: typeof lotte.chunks;
  }> = [];

  for (const [pageId, acc] of byPage) {
    const title = pageTitleById.get(pageId) || "";
    const built = buildNotionChunks(pageId, acc.rows, {
      pageTitle: title,
      minBodyChars: NOTION_CHUNK_MIN_BODY_CHARS
    });
    totalChunksEst += built.chunks.length;
    totalSkippedThin += built.skippedThin;
    for (const c of built.chunks) totalChars += c.text.length;

    if (!acc.hasHeading && built.chunks.length >= 2 && noHeadingSamples.length < 2) {
      noHeadingSamples.push({ title, chunks: built.chunks });
    }
  }

  console.log("\n=== 2. heading 없는 문서 샘플 2개 ===");
  noHeadingSamples.forEach((s, i) => {
    console.log(`\n#### sample page ${i + 1}: ${s.title} (${s.chunks.length} chunks)`);
    s.chunks.forEach((c, j) => {
      console.log(`\n--- chunk ${j} ---`);
      console.log(c.text);
    });
  });

  console.log("\n=== 3. 알맹이 없어 제외된 청크(섹션) 수 ===");
  console.log(`skippedThin total: ${totalSkippedThin}`);

  console.log("\n=== 4. 최종 예상 청크 수 ===");
  console.log(`estimated chunks: ${totalChunksEst}`);
  console.log(`estimated chars: ${totalChars}`);
  const estTokens = Math.ceil(totalChars / 2);
  console.log(`estimated tokens (~chars/2): ${estTokens}`);
  console.log(
    `estimated embed cost: $${estimateEmbeddingCostUsd(estTokens).toFixed(4)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
