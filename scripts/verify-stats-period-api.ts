/**
 * 통계 기간 조회 실측 — website_stats 만 읽는지, 30일과 1년이 다른지
 * npx tsx scripts/verify-stats-period-api.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

const WEBSITE = process.env.WEBSITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
const SECRET = process.env.ADMIN_API_SECRET?.trim();

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function summarize(kind: string, data: Record<string, unknown>) {
  const block = data[kind] as
    | {
        current?: { date?: string; impressions?: number | null; clicks?: number | null }[];
        overall?: unknown[];
        overall_period?: { from: string; to: string } | null;
        totals?: {
          impressions?: { current: number | null };
          clicks?: { current: number | null };
        };
      }
    | undefined;
  if (!block) return null;
  const dates = (block.current ?? []).map((row) => row.date).filter(Boolean) as string[];
  return {
    currentRows: block.current?.length ?? 0,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    impressions: block.totals?.impressions?.current ?? null,
    clicks: block.totals?.clicks?.current ?? null,
    overallRows: block.overall?.length ?? 0,
    overallPeriod: block.overall_period ?? null,
  };
}

async function fetchRange(from: string, to: string) {
  const url = `${WEBSITE}/api/admin/stats?from=${from}&to=${to}&kinds=daily,query,country,device,page`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SECRET}` } });
  const body = (await res.json()) as { data?: Record<string, unknown>; error?: string };
  if (!res.ok) throw new Error(`stats ${res.status} ${body.error ?? ""}`);
  return body.data ?? {};
}

async function main() {
  if (!SECRET) throw new Error("ADMIN_API_SECRET missing");
  const today = seoulToday();
  const d30 = { from: addDays(today, -29), to: today };
  const y1 = { from: addMonths(today, -12), to: today };

  const [a, b] = await Promise.all([fetchRange(d30.from, d30.to), fetchRange(y1.from, y1.to)]);

  console.log("\n=== stats period API ===");
  console.log("today:", today);
  console.log("30d range:", d30);
  console.log("1y range:", y1);
  console.log("30d daily:", JSON.stringify(summarize("daily", a)));
  console.log("1y daily:", JSON.stringify(summarize("daily", b)));
  console.log("30d query overall:", JSON.stringify(summarize("query", a)));
  console.log("1y query overall:", JSON.stringify(summarize("query", b)));
  console.log("has baseline key:", Object.values(a).some((v) => v && typeof v === "object" && "baseline" in (v as object)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
