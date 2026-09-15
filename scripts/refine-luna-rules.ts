/**
 * 규칙 후보 정제 — 쓰레기 candidate dropped + rejected 쌍만으로 재추출
 * NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/refine-luna-rules.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  countRulesByStatus,
  listRules,
  mineRuleCandidatesFromSignals
} from "@/lib/luna/rules";
import { ruleQuestionText } from "@/lib/luna/rules-shared";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const before = await countRulesByStatus(admin);
  const beforeCandidates = await listRules(admin, { status: "candidate" });
  console.log("[before]", JSON.stringify(before));
  console.log(
    "[before candidates]",
    beforeCandidates.map((r) => `${r.pattern_type}:${r.pattern_value}`).join(", ")
  );

  const mined = await mineRuleCandidatesFromSignals(admin);
  console.log("[mine]", JSON.stringify(mined));

  const after = await countRulesByStatus(admin);
  const candidates = await listRules(admin, { status: "candidate" });
  console.log("[after]", JSON.stringify(after));
  console.log("[remaining]", candidates.length);
  for (const r of candidates) {
    const examples = Array.isArray(r.evidence?.examples)
      ? (r.evidence.examples as string[]).slice(0, 3)
      : [];
    const linkIds = Array.isArray(r.evidence?.link_ids)
      ? (r.evidence.link_ids as string[]).slice(0, 5)
      : [];
    console.log(
      JSON.stringify(
        {
          pattern_type: r.pattern_type,
          pattern_value: r.pattern_value,
          signal_count: r.signal_count,
          classify: r.evidence?.classify ?? null,
          question: ruleQuestionText(r),
          examples,
          link_ids: linkIds
        },
        null,
        2
      )
    );
  }

  const inspire =
    candidates.some((r) => r.pattern_value.includes("인스파이어")) ||
    beforeCandidates
      .filter((r) => r.pattern_value.includes("인스파이어"))
      .every((old) => !candidates.some((c) => c.id === old.id));
  const inspireStill = candidates.some((r) =>
    r.pattern_value.includes("인스파이어")
  );
  console.log("[inspire_excluded]", !inspireStill);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
