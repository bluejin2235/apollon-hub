/**
 * 답 모순 판정 소급 — 최근 assistant 메시지에 적용
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/backfill-answer-flags.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  backfillAnswerFlags,
  evaluateAnswerFlags,
  metricsFromAssistantMeta
} from "../lib/luna/answer-flags";
import { ANSWER_FLAG_LABELS } from "../lib/luna/answer-flags-shared";

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
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  console.log(JSON.stringify({ since }, null, 2));

  const result = await backfillAnswerFlags(admin, {
    sinceIso: since,
    limit: 100
  });

  console.log(
    JSON.stringify(
      {
        scanned: result.scanned,
        flagged: result.flagged,
        samples: result.samples.slice(0, 5).map((s) => ({
          question: s.question.slice(0, 60),
          severity: s.severity,
          flags: s.flags.map((f) => ANSWER_FLAG_LABELS[f.id] ?? f.id),
          metrics: {
            docs: s.metrics.total_docs,
            conf: s.metrics.confidence_score,
            intent: s.metrics.intent_score,
            duration_ms: s.metrics.duration_ms,
            search_ms: s.metrics.search_ms,
            notion: s.metrics.notion_n,
            wiki: s.metrics.wiki_n
          }
        }))
      },
      null,
      2
    )
  );

  // 볼팍 사례 수동 확인
  const demoQ = "볼팍견적이 뭐야?";
  const demo = evaluateAnswerFlags(
    metricsFromAssistantMeta(demoQ, {
      intent_score: 8,
      confidence_score: 7,
      duration_ms: 26281,
      timings: {
        search_ms: 4805,
        candidates_found: 32,
        candidates_used: 12
      },
      notion_sources: Array.from({ length: 32 }, (_, i) => ({ id: i })),
      wiki_sources: [{ slug: "x" }],
      memory_count: 0
    })
  );
  console.log(
    JSON.stringify(
      {
        demo: demoQ,
        flags: demo.flags.map((f) => f.label),
        metrics: demo.metrics
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
