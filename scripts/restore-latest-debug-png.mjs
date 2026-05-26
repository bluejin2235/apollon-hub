import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

const env = loadEnvLocal();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data, error } = await supabase
  .from("print_jobs")
  .select("id, payload, created_at, status")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (error || !data?.payload?.imageBase64) {
  console.error("NO_JOB", error?.message ?? "missing imageBase64");
  process.exit(1);
}

let b64 = data.payload.imageBase64;
if (b64.includes(",")) b64 = b64.split(",")[1];
const buf = Buffer.from(b64, "base64");
const debugDir = "Z:/apollon-print-bridge/debug";
mkdirSync(debugDir, { recursive: true });
const name = `apollon-label-${data.id}.png`;
const out = resolve(debugDir, name);
writeFileSync(out, buf);
console.log(JSON.stringify({ name, path: out, bytes: buf.length, status: data.status, created_at: data.created_at }));
