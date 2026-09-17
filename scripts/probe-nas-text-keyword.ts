/**
 * 플랜 A 검증 — 본문 trigram 으로 Lucky Picker 검색
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/probe-nas-text-keyword.ts
 *
 * 전량 임베딩 없음. 본문이 없으면 Lucky 경로 PDF 에 짧은 본문 샘플을 넣는다.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNasTextKeyword } from "../lib/luna/nas-text-keyword";

const LUCKY_PDF =
  "06 롯데 면세점 스타에비뉴 리뉴얼\\01 Document\\- Review 및 회의자료\\251219 체험콘텐츠_Lucky Picker_디자인 디벨롭_고객사 공유\\Apollon_롯데면세점 스타에비뉴_Lucky Picker_디자인 디벨롭 사항_고객사 보고_251219.pdf";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { count: textCount } = await admin
    .from("nas_file_text")
    .select("path", { count: "exact", head: true });
  const { count: chunkCount } = await admin
    .from("nas_file_chunks")
    .select("id", { count: "exact", head: true });

  console.log(
    JSON.stringify(
      { nas_file_text: textCount, nas_file_chunks: chunkCount },
      null,
      2
    )
  );

  // 본문에 Lucky 가 없으면 샘플 1건 삽입 (추출 대용 · 임베딩 null)
  const { count: luckyBody } = await admin
    .from("nas_file_chunks")
    .select("id", { count: "exact", head: true })
    .ilike("content", "%Lucky Picker%");

  if ((luckyBody ?? 0) === 0) {
    console.log("injecting Lucky Picker body sample for probe…");
    await admin.from("nas_file_text").upsert(
      {
        path: LUCKY_PDF,
        drive: "T",
        ext: "pdf",
        size_bytes: 1,
        modified_at: "2025-12-19T00:00:00+09:00",
        content_hash: "probe-lucky-picker-a",
        text_length: 120,
        chunk_count: 1,
        status: "ok",
        extracted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: "path" }
    );
    await admin.from("nas_file_chunks").delete().eq("path", LUCKY_PDF);
    await admin.from("nas_file_chunks").insert({
      path: LUCKY_PDF,
      seq: 0,
      content:
        "체험 콘텐츠 Lucky Picker 디자인 디벨롭. 롯데면세점 스타에비뉴 고객사 보고. 인터랙션·LED Wall·Mobile.",
      embedding: null
    });
  }

  const t0 = Date.now();
  const hits = await searchNasTextKeyword(admin, "Lucky Picker", { limit: 10 });
  const ms = Date.now() - t0;

  console.log(
    JSON.stringify(
      {
        query: "Lucky Picker",
        ms,
        hit_count: hits.length,
        top: hits.slice(0, 5).map((h) => ({
          score: h.score,
          reasons: h.reasons,
          path: h.path.slice(0, 120),
          snippet: h.snippet.slice(0, 80)
        }))
      },
      null,
      2
    )
  );

  const pathOnly = await admin
    .from("nas_directory")
    .select("path")
    .ilike("path", "%Lucky Picker%")
    .limit(5);
  console.log(
    JSON.stringify(
      {
        path_ilike_also: (pathOnly.data ?? []).map((r) =>
          String(r.path).slice(0, 100)
        )
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
