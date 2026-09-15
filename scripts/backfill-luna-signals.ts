/**
 * 부정 신호 백필 + 내장 규칙 재판정
 * NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/backfill-luna-signals.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { backfillLunaSignals } from "@/lib/luna/signals-backfill";
import {
  ensureBuiltinLinkRules,
  mineRuleCandidatesFromSignals,
  rejudgeNeedWithBuiltinRules,
  countRulesByStatus
} from "@/lib/luna/rules";
import { sameReviewCounts } from "@/lib/luna-admin/links";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const before = await sameReviewCounts(admin);
  console.log("[before] need=", before.need, "rejected=", before.rejected);

  const backfill = await backfillLunaSignals(admin);
  console.log("[backfill]", JSON.stringify(backfill));

  const builtins = await ensureBuiltinLinkRules(admin);
  console.log("[builtin rules]", builtins);

  const rejudge = await rejudgeNeedWithBuiltinRules(admin);
  console.log("[rejudge]", JSON.stringify(rejudge));

  const mined = await mineRuleCandidatesFromSignals(admin);
  console.log("[mine]", JSON.stringify(mined));

  const after = await sameReviewCounts(admin);
  const rules = await countRulesByStatus(admin);
  console.log("[after] need=", after.need, "rejected=", after.rejected);
  console.log("[rules]", JSON.stringify(rules));
  console.log(
    JSON.stringify(
      {
        signals_by_kind: backfill.by_kind,
        need_before: before.need,
        need_after: after.need,
        rejudge,
        rule_candidates: rules.candidate,
        rules_active: rules.active
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
