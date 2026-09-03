/**
 * Trace empty <p></p> via website admin API / website supabase env
 * npx tsx scripts/trace-empty-p.ts
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(readFileSync(resolve(process.cwd(), "../apollon-website/.env.local")));

import { createClient } from "@supabase/supabase-js";
import { sanitizeInsightHtml } from "../lib/website/insight-html";

async function main() {
  const url = websiteEnv.NEXT_PUBLIC_SUPABASE_URL!;
  const key = websiteEnv.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: insights, error: e1 } = await admin
    .from("insights")
    .select("id,slug,updated_at")
    .gte("id", "ed2cba6a-0000-0000-0000-000000000000")
    .lte("id", "ed2cba6a-ffff-ffff-ffff-ffffffffffff");
  if (e1) throw e1;
  const insight = insights?.[0];
  if (!insight) {
    // fallback: search all text blocks for empty p
    const { data: all, error } = await admin
      .from("insight_blocks")
      .select("id,insight_id,sort,preset,body,updated_at")
      .eq("preset", "text")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    const hits = (all ?? []).filter((b) => {
      const ko = String((b.body as { ko?: string } | null)?.ko ?? "");
      return /<p>\s*<\/p>/i.test(ko) || ko.includes("<p></p>");
    });
    mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
    writeFileSync(
      resolve(process.cwd(), "tmp", "trace-empty-p.json"),
      JSON.stringify({ mode: "scan", hits }, null, 2)
    );
    console.log("NO_PREFIX_MATCH scanned", hits.length);
    for (const h of hits.slice(0, 5)) {
      console.log(JSON.stringify({ id: h.id, insight_id: h.insight_id, sort: h.sort }));
    }
    return;
  }

  const { data: blocks, error: e2 } = await admin
    .from("insight_blocks")
    .select("id,sort,preset,body,updated_at,created_at")
    .eq("insight_id", insight.id)
    .order("sort");
  if (e2) throw e2;

  const report = {
    insightId: insight.id,
    slug: insight.slug,
    blocks: (blocks ?? []).map((b) => {
      const body = (b.body ?? {}) as { ko?: string; en?: string };
      const ko = body.ko ?? "";
      const en = body.en ?? "";
      const sanitizedKo = sanitizeInsightHtml(ko);
      return {
        id: b.id,
        sort: b.sort,
        preset: b.preset,
        updated_at: b.updated_at,
        created_at: b.created_at,
        koRaw: ko,
        koHasEmptyP: /<p>\s*<\/p>/i.test(ko),
        koHasBrP: /<p>\s*<br\s*\/?>\s*<\/p>/i.test(ko),
        afterSanitize: sanitizedKo,
        sanitizeWouldChange: sanitizedKo !== ko,
        sanitizeStillHasEmptyP: /<p>\s*<\/p>/i.test(sanitizedKo)
      };
    })
  };

  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const out = resolve(process.cwd(), "tmp", "trace-empty-p.json");
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log("WROTE", out);
  console.log(
    JSON.stringify(
      {
        insightId: report.insightId,
        slug: report.slug,
        summary: report.blocks.map((b) => ({
          sort: b.sort,
          preset: b.preset,
          koHasEmptyP: b.koHasEmptyP,
          sanitizeWouldChange: b.sanitizeWouldChange,
          sanitizeStillHasEmptyP: b.sanitizeStillHasEmptyP
        }))
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
