/**
 * follows 재분류 + NAS/노션 병합 실행 후 건수·샘플 보고
 * NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/reclassify-follows.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { buildLinks } from "@/lib/luna-admin/build-links";
import { NOTION_RELATION_KIND_RULES } from "@/lib/luna-admin/notion-relation-kinds";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  console.log("── 속성 → 종류 대응표 ──");
  for (const r of NOTION_RELATION_KIND_RULES) {
    const dir =
      r.kind === "follows" ? ` · ${r.direction ?? "forward"}` : "";
    console.log(`  ${r.kind.padEnd(8)} ${r.property}${dir}`);
  }

  const before: Record<string, number | null> = {};
  for (const k of ["belongs", "follows", "same"]) {
    const { count } = await admin
      .from("luna_links")
      .select("id", { count: "exact", head: true })
      .eq("kind", k)
      .neq("status", "rejected");
    before[k] = count;
  }
  console.log("\n[before]", before);

  const report = await buildLinks(admin, {
    kind: "follows",
    log: (m) => console.log(m)
  });

  const after: Record<string, number | null> = {};
  for (const k of ["belongs", "follows", "same"]) {
    const { count } = await admin
      .from("luna_links")
      .select("id", { count: "exact", head: true })
      .eq("kind", k)
      .neq("status", "rejected");
    after[k] = count;
  }
  console.log("\n[after]", after);
  console.log("[report.follows]", {
    inserted: report.follows.inserted,
    skipped: report.follows.skipped,
    nas_name: report.follows.nas_name,
    notion_relations: report.follows.notion_relations,
    dual_source: report.follows.dual_source,
    reclassified_from_belongs: report.follows.reclassified_from_belongs
  });

  const { data: samples } = await admin
    .from("luna_links")
    .select("from_type, to_type, confidence, evidence")
    .eq("kind", "follows")
    .neq("status", "rejected")
    .order("confidence", { ascending: false })
    .limit(20);

  const notionOnes = (samples ?? []).filter(
    (r) =>
      r.from_type === "notion_page" ||
      (Array.isArray((r.evidence as { sources?: string[] })?.sources) &&
        ((r.evidence as { sources: string[] }).sources.includes(
          "notion_relation"
        ) as boolean))
  );
  const pick = [
    ...(notionOnes.slice(0, 2) as typeof samples),
    ...((samples ?? []).filter((r) => r.from_type === "nas_path").slice(0, 2) as typeof samples)
  ].slice(0, 3);

  console.log("\n── 샘플 (from → to) ──");
  for (const row of pick) {
    const ev = (row?.evidence as Record<string, unknown>) ?? {};
    console.log(
      JSON.stringify({
        from: ev.from_title,
        to: ev.to_title,
        from_type: row?.from_type,
        to_type: row?.to_type,
        confidence: row?.confidence,
        sources: ev.sources,
        property_name: ev.property_name,
        rule: ev.rule
      })
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
