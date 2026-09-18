/**
 * 자율 자습 아젠다 — DB 스캔 · 후보 · 10건 시험 실행
 * npx tsx scripts/run-study-agenda-once.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);
try {
  require.cache[require.resolve("server-only")] = {
    id: require.resolve("server-only"),
    filename: require.resolve("server-only"),
    loaded: true,
    exports: {}
  } as NodeModule;
} catch {
  /* ignore */
}

import { createClient } from "@supabase/supabase-js";
import { scanStudyGaps } from "@/lib/luna/study-scan";
import { selectTonightAgenda } from "@/lib/luna/study-agenda";
import { executeStudyAgenda } from "@/lib/luna/study-run";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const admin = adminClient();
  const { sources, gaps } = await scanStudyGaps(admin);
  const { candidates, selected, demoted } = await selectTonightAgenda(admin);

  console.log("=== 점검 소스 ===");
  console.log(
    sources.map((s) => `${s.table} [${s.capabilities.join(",")}]`).join("\n")
  );

  console.log("\n=== 부족함 ===");
  for (const g of gaps) {
    console.log(`- ${g.signal} (method=${g.method}, verifiable=${g.verifiable})`);
  }

  console.log("\n=== 오늘 밤 후보 (정답 있는 것) ===");
  const tonight = selected.filter((s) => s.when === "tonight" && !s.excluded);
  for (const c of tonight) {
    console.log(`- ${c.agenda}`);
    console.log(`  왜: ${c.why}`);
    console.log(`  예상: ${c.expected} · ${c.minutes}분`);
  }
  console.log("\n=== 보류 (정답 없음 / demoted) ===");
  for (const c of selected.filter((s) => s.when === "tomorrow")) {
    console.log(`- ${c.agenda} · ${c.why}`);
  }
  if (demoted.length) {
    console.log(
      "demoted:",
      demoted.map((d) => `${d.agenda} (${d.reason})`).join(" | ")
    );
  }

  const first = tonight[0] ?? candidates.find((c) => c.verifiable);
  if (!first) {
    console.log("\n실행할 검증 가능 아젠다 없음");
    return;
  }

  console.log(`\n=== 시험 실행 (10건): ${first.agenda} ===`);
  const { run } = await executeStudyAgenda(admin, first, { limit: 10 });
  console.log(
    JSON.stringify(
      {
        id: run.id,
        outcome: run.outcome,
        cost_usd: run.cost_usd,
        llm_calls: run.llm_calls,
        result: run.result
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
