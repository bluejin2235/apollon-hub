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
  blocksToChunks,
  NOTION_CHUNK_MAX_CHARS,
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

  // 1) 롯데타워 페이지 찾기
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

  const chunks = blocksToChunks(target.page_id, indexed, {
    minChars: NOTION_CHUNK_MIN_CHARS,
    maxChars: NOTION_CHUNK_MAX_CHARS
  });

  console.log("\n=== 1. 롯데타워 1st Ideation 청크 수 ===");
  console.log(`title: ${target.title}`);
  console.log(`page_id: ${target.page_id}`);
  console.log(`blocks: ${indexed.length} → chunks: ${chunks.length}`);

  const lucky = chunks.filter((c) => /Lucky Picker/i.test(c.text));
  console.log(`Lucky Picker 포함 청크: ${lucky.length}`);

  console.log("\n=== 2. 샘플 청크 3개 (전문) ===");
  const samples = [
    chunks.find((c) => /Lucky Picker/i.test(c.text)),
    chunks.find((c) => /120/i.test(c.text) || /120층/i.test(c.heading)),
    chunks[Math.floor(chunks.length / 2)]
  ].filter(Boolean);
  const uniq = [...new Map(samples.map((c) => [c!.chunk_id, c!])).values()].slice(
    0,
    3
  );
  while (uniq.length < 3 && uniq.length < chunks.length) {
    const next = chunks.find((c) => !uniq.some((u) => u.chunk_id === c.chunk_id));
    if (!next) break;
    uniq.push(next);
  }
  uniq.forEach((c, i) => {
    console.log(`\n--- sample ${i + 1} (pos=${c.position}, chars=${c.text.length}, heading=${JSON.stringify(c.heading)}) ---`);
    console.log(c.text);
  });

  // 3–4) 전체 페이지 블록을 스트리밍으로 읽어 청크 추정
  console.log("\n=== 3. heading 없는 문서 / 4. 전체 예상 ===");
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
      if (!pageTitleById.has(pageId)) continue; // archived 제외
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

  let noHeadingPages = 0;
  let totalChunksEst = 0;
  let totalChars = 0;
  const noHeadingExamples: string[] = [];
  const totalPages = pageTitleById.size;

  for (const [pageId, acc] of byPage) {
    if (!acc.hasHeading) {
      noHeadingPages += 1;
      if (noHeadingExamples.length < 5) {
        noHeadingExamples.push(pageTitleById.get(pageId) || "(제목 없음)");
      }
    }
    const pageChunks = blocksToChunks(pageId, acc.rows);
    totalChunksEst += pageChunks.length;
    for (const c of pageChunks) totalChars += c.text.length;
  }

  // 블록 0개인 페이지도 no-heading으로 셈
  for (const pageId of pageTitleById.keys()) {
    if (!byPage.has(pageId)) {
      noHeadingPages += 1;
      if (noHeadingExamples.length < 5) {
        noHeadingExamples.push(pageTitleById.get(pageId) || "(제목 없음)");
      }
    }
  }

  const estTokens = Math.ceil(totalChars / 2);
  const estCost = estimateEmbeddingCostUsd(estTokens);

  console.log(`pages scanned: ${totalPages}`);
  console.log(
    `no-heading pages: ${noHeadingPages} (${((noHeadingPages / Math.max(1, totalPages)) * 100).toFixed(1)}%)`
  );
  console.log(`처리: heading="" 로 본문만 묶어 청크. 15자 미만은 스킵.`);
  console.log(`examples: ${noHeadingExamples.join(" | ")}`);
  console.log(`estimated chunks: ${totalChunksEst}`);
  console.log(`estimated chars: ${totalChars}`);
  console.log(`estimated tokens (~chars/2): ${estTokens}`);
  console.log(
    `estimated embed cost (text-embedding-3-small $0.02/1M): $${estCost.toFixed(4)}`
  );
  console.log(`(현재 블록 임베딩 ~28,537 대비)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
