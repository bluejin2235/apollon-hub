/**
 * 2차 데이터 생성
 *
 *   npx tsx scripts/build-links.ts
 *   npx tsx scripts/build-links.ts --year=2026
 *   npx tsx scripts/build-links.ts --kind=belongs
 *   npx tsx scripts/build-links.ts --dry-run
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import {
  buildLinks,
  type BuildKind
} from "@/lib/luna-admin/build-links";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const yearRaw = arg("year");
  const kindRaw = arg("kind");
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (yearRaw && !Number.isFinite(year)) {
    throw new Error(`invalid --year=${yearRaw}`);
  }
  const kind: BuildKind | undefined =
    kindRaw === "belongs" ||
    kindRaw === "follows" ||
    kindRaw === "same" ||
    kindRaw === "perspectives"
      ? kindRaw
      : kindRaw
        ? (() => {
            throw new Error(
              `invalid --kind=${kindRaw} (belongs|follows|same|perspectives)`
            );
          })()
        : undefined;
  const dryRun = hasFlag("dry-run");

  const report = await buildLinks(adminClient(), {
    year,
    kind,
    dryRun,
    log: (msg) => console.log(msg)
  });

  console.log("");
  console.log("── 결과 ──");
  console.log(
    `belongs  inserted=${report.belongs.inserted} would=${report.belongs.would} skip=${report.belongs.skipped}`
  );
  console.log(
    `         files=${report.belongs.nas_files} bundles=${report.belongs.nas_bundles} images=${report.belongs.images} notion=${report.belongs.notion_pages} rels=${report.belongs.notion_relations}`
  );
  console.log(
    `follows  inserted=${report.follows.inserted} would=${report.follows.would} skip=${report.follows.skipped}`
  );
  console.log(
    `         nas=${report.follows.nas_name} notion=${report.follows.notion_relations} dual=${report.follows.dual_source} reclass=${report.follows.reclassified_from_belongs}`
  );
  console.log(
    `same     inserted=${report.same.inserted} would=${report.same.would} human=${report.same.human} auto=${report.same.auto} ask=${report.same.asked} drop=${report.same.dropped}`
  );
  console.log(
    `questions ${report.questions}  llm ${report.llm_calls}  $${report.llm_usd.toFixed(4)}  ${Math.round(report.elapsed_ms / 1000)}s`
  );
  if (report.llm_aborted) {
    console.log(
      `LLM 중단: 한도 500을 넘김. 남은 후보 ${report.llm_remaining}건`
    );
  }
  if (report.perspectives.top.length) {
    console.log("관점 상위:");
    for (const row of report.perspectives.top) {
      console.log(`  ${row.hit_count}\t${row.name}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
