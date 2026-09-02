/**
 * Realtime API 실측 — npx tsx scripts/verify-stats-realtime.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../apollon-website/.env.local") });

const WEBSITE = process.env.WEBSITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:3100";
const SECRET = process.env.ADMIN_API_SECRET?.trim();

async function main() {
  if (!SECRET) throw new Error("ADMIN_API_SECRET missing in apollon-website/.env.local");

  const res = await fetch(`${WEBSITE}/api/admin/stats/realtime`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  const body = await res.json();

  console.log("\n=== stats realtime API ===");
  console.log("status:", res.status);
  console.log("ok:", res.ok);
  console.log("data:", JSON.stringify(body?.data ?? body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
