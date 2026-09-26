import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ quiet: true });
import { createClient } from "@supabase/supabase-js";
import { parseNasSampleArgs, runNasEmbeddingSample } from "@/lib/luna/nas-embedding-sample";

async function main() {
  const options = parseNasSampleArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase URL and service key required in the existing process environment");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) }
  });
  console.log(JSON.stringify(await runNasEmbeddingSample(admin, options), null, 2));
}

main().catch(error => {
  // This runner's own errors contain neither source text nor credentials.
  console.error(error instanceof Error ? error.message : "NAS sample validation failed");
  process.exitCode = 1;
});
