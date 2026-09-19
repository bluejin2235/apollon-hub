/**
 * memo 오타 정규화 검증 + 현재 3건 스캔
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";
import {
  editDistance,
  findMemoShorthandCandidates,
  loadGlossaryCanon,
  normalizeMemoAgainstGlossary
} from "@/lib/luna/memo-glossary-normalize";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )!.trim();
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const canon = await loadGlossaryCanon(admin);

  const samples = [
    "볼팰견적(내부 원가·마진 시뮬레이션)",
    "볼펠견적 관련",
    "볼팍견적 그대로",
    "미디어파사드 · 인스파이어"
  ];
  const sampleOut = samples.map((s) => {
    const n = normalizeMemoAgainstGlossary(s, canon);
    return {
      in: s,
      text: n.text,
      fixes: n.fixes,
      skippedFuzzy: n.skippedFuzzy,
      dist_볼팰: editDistance("볼팰견적", "볼팍견적"),
      dist_볼펠: editDistance("볼펠견적", "볼팍견적"),
      dist_프로그램_홀로그램: editDistance("프로그램", "홀로그램")
    };
  });

  // 의도적 오교정 회귀
  const bad = normalizeMemoAgainstGlossary(
    "미디어 프로그램과 홀로그램을 구분한다",
    canon
  );

  const { data: mems } = await admin
    .from("luna_user_memories")
    .select("user_id, memo, source_count")
    .neq("memo", "");

  const scans = [];
  for (const m of mems ?? []) {
    const { data: p } = await admin
      .from("profiles")
      .select("name, department")
      .eq("id", m.user_id)
      .maybeSingle();
    const memo = String(m.memo ?? "");
    const norm = normalizeMemoAgainstGlossary(memo, canon);
    const shorts = findMemoShorthandCandidates(memo, canon);
    scans.push({
      name: p?.name,
      department: p?.department,
      source_count: m.source_count,
      fixes: norm.fixes,
      skippedFuzzy: norm.skippedFuzzy,
      would_change: norm.text !== memo,
      shorthands: shorts,
      memo_preview: memo.slice(0, 500)
    });
  }

  const out = {
    glossary_n: canon.officials.length,
    sampleOut,
    programGuard: {
      text: bad.text,
      fixes: bad.fixes,
      skippedFuzzy: bad.skippedFuzzy,
      programIntact: bad.text.includes("프로그램"),
      hologramKept: bad.text.includes("홀로그램")
    },
    scans
  };
  writeFileSync(
    resolve("tmp/memo-glossary-scan.json"),
    JSON.stringify(out, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
