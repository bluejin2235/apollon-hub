import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const run = JSON.parse(
  readFileSync("tmp/persona-9x15/run-20260919125017.json", "utf8")
);
const results = run.results || [];
const ok = results.filter((r: { ok: boolean }) => r.ok);
const fail = results.filter((r: { ok: boolean }) => !r.ok);

type Acc = { wall: number[]; ui: number[] };
const byType: Record<string, Acc> = {};
for (const r of ok as Array<{
  type: string;
  wallSec?: number;
  uiSec?: number | null;
}>) {
  byType[r.type] ??= { wall: [], ui: [] };
  if (r.wallSec != null) byType[r.type]!.wall.push(r.wallSec);
  if (r.uiSec != null) byType[r.type]!.ui.push(r.uiSec);
}
const avg = (a: number[]) =>
  a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
const typeAvg = Object.fromEntries(
  Object.entries(byType).map(([k, v]) => [
    k,
    { wall: avg(v.wall), ui: avg(v.ui), n: v.wall.length }
  ])
);

const missOk = (
  ok as Array<{ type: string; notFoundGuide?: Record<string, boolean> }>
).filter((r) => r.type === "miss");
const guide = { all3: 0, why: 0, detail: 0, next: 0, n: missOk.length };
for (const r of missOk) {
  const g = r.notFoundGuide || {};
  if (g.hasWhy) guide.why += 1;
  if (g.hasDetail) guide.detail += 1;
  if (g.hasNext) guide.next += 1;
  if (g.hasWhy && g.hasDetail && g.hasNext) guide.all3 += 1;
}

const failBy: Record<string, number> = {};
for (const r of fail as Array<{ error?: string }>) {
  const k = (r.error || "").split("\n")[0]!.slice(0, 100);
  failBy[k] = (failBy[k] || 0) + 1;
}

const perPerson: Record<
  string,
  { ok: number; fail: number; found: number; not_found: number; skip: number }
> = {};
for (const r of results as Array<{
  ok: boolean;
  person: { name: string };
  reaction: string;
}>) {
  const n = r.person.name;
  perPerson[n] ??= { ok: 0, fail: 0, found: 0, not_found: 0, skip: 0 };
  if (r.ok) {
    perPerson[n]!.ok += 1;
    const key = r.reaction as "found" | "not_found" | "skip";
    perPerson[n]![key] += 1;
  } else perPerson[n]!.fail += 1;
}

async function cleanupCheck() {
  const a = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { count: c1 } = await a
    .from("luna_conversations")
    .select("id", { count: "exact", head: true })
    .like("title", "[P9TEST:%");
  const { data: beta } = await a
    .from("luna_beta_access")
    .select("profile_id, note")
    .like("note", "P9TEST:%");
  return { p9convs: c1, p9beta: beta?.length ?? 0 };
}

cleanupCheck().then((cleanup) => {
  const out = {
    typeAvg,
    guide,
    failN: fail.length,
    failBy,
    thumbs: (ok as Array<{ thumbs?: string | null }>).filter((r) => r.thumbs)
      .length,
    perPerson,
    techLeak: (
      results as Array<{ hasTechLeak?: boolean }>
    ).filter((r) => r.hasTechLeak).length,
    cleanup
  };
  writeFileSync(
    "tmp/persona-9x15/analysis.json",
    JSON.stringify(out, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(out, null, 2));
});
