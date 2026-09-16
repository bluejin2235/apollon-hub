/**
 * Artificial Analysis 시세 수집 + 주간 점검 1회
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/run-model-market-once.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
config();

import { createClient } from "@supabase/supabase-js";
import {
  artificialAnalysisApiKey,
  loadLatestMarketSnapshot
} from "../lib/luna/model-market";
import { runModelInspect } from "../lib/luna/model-auto-swap";
import { kstIsoDate } from "../lib/fx/dates";
import { getRateForDateOrFallback } from "../lib/fx/get-rate-for-date";
import { evaluateLunaChecks } from "../lib/luna/checks";

function num(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function changed(
  a: number | null,
  b: number | null
): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > 1e-9;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const keyPresent = Boolean(artificialAnalysisApiKey());
  console.log("AA key present:", keyPresent);
  const admin = adminClient();
  const before = await loadLatestMarketSnapshot(admin);
  console.log(
    "before snapshot:",
    before.fetched_at,
    "rows=",
    before.rows.length
  );

  const checksBefore = await evaluateLunaChecks(admin);
  console.log(
    "stale before:",
    checksBefore
      .filter((c) => c.status === "warn" || c.status === "bad")
      .map((c) => `${c.status === "bad" ? "🔴" : "🟡"} ${c.label} ${c.days_stale ?? "?"}일`)
      .join(" | ") || "(none)"
  );

  const usdKrw = await getRateForDateOrFallback(admin, kstIsoDate());
  const inspect = await runModelInspect(admin, { force: true, usdKrw });
  console.log("fetch via inspect:", inspect.ok, inspect.market_count, inspect.message);
  if (inspect.market_error) {
    console.log("market_error:", inspect.market_error);
  }

  const after = await loadLatestMarketSnapshot(admin);
  console.log("after snapshot:", after.fetched_at, "rows=", after.rows.length);

  const prev = new Map(before.rows.map((r) => [r.model_slug, r]));
  const next = new Map(after.rows.map((r) => [r.model_slug, r]));
  let priceChanged = 0;
  let intelChanged = 0;
  let either = 0;
  const added: string[] = [];
  const removed: string[] = [];
  for (const [slug, row] of next) {
    const old = prev.get(slug);
    if (!old) {
      added.push(slug);
      continue;
    }
    const p =
      changed(num(old.price_blended), num(row.price_blended)) ||
      changed(num(old.price_input), num(row.price_input)) ||
      changed(num(old.price_output), num(row.price_output));
    const i = changed(num(old.intelligence_index), num(row.intelligence_index));
    if (p) priceChanged += 1;
    if (i) intelChanged += 1;
    if (p || i) either += 1;
  }
  for (const slug of prev.keys()) {
    if (!next.has(slug)) removed.push(slug);
  }
  console.log(
    JSON.stringify(
      {
        compared: Math.min(prev.size, next.size),
        price_changed: priceChanged,
        intelligence_changed: intelChanged,
        price_or_intelligence_changed: either,
        added: added.length,
        removed: removed.length,
        added_sample: added.slice(0, 8),
        removed_sample: removed.slice(0, 8)
      },
      null,
      2
    )
  );

  console.log(
    "inspect:",
    JSON.stringify(
      {
        ok: inspect.ok,
        message: inspect.message,
        market_count: inspect.market_count,
        market_error: inspect.market_error,
        swapped: inspect.swapped,
        proposals: inspect.proposals
      },
      null,
      2
    )
  );

  const checksAfter = await evaluateLunaChecks(admin);
  console.log(
    "stale after:",
    checksAfter
      .filter((c) => c.status === "warn" || c.status === "bad")
      .map((c) => `${c.status === "bad" ? "🔴" : "🟡"} ${c.label} ${c.days_stale ?? "?"}일`)
      .join(" | ") || "(none)"
  );

  if (inspect.market_error) process.exitCode = 1;
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
