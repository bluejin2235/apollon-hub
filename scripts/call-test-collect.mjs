/**
 * Call /api/research/sources/test-collect on local dev server with auth.
 * Usage: node scripts/call-test-collect.mjs [source_id]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;

async function getAccessToken(admin) {
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1 });
  if (usersError || !usersData.users[0]?.email) {
    throw new Error(`No auth users: ${usersError?.message ?? "empty"}`);
  }

  const email = usersData.users[0].email;
  console.log("[call-test-collect] auth user:", email);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkError?.message}`);
  }

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: sessionData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email"
  });

  if (verifyError || !sessionData.session?.access_token) {
    throw new Error(`verifyOtp failed: ${verifyError?.message}`);
  }

  return sessionData.session.access_token;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let sourceId = process.argv[2];
  if (!sourceId) {
    const { data } = await admin
      .from("trend_sources")
      .select("id, name, url")
      .order("created_at", { ascending: false })
      .limit(1);
    sourceId = data?.[0]?.id;
    console.log("[call-test-collect] source:", data?.[0]?.name, data?.[0]?.url, sourceId);
  }

  const token = await getAccessToken(admin);

  const date = new Date();
  const dateTo = date.toISOString().slice(0, 10);
  date.setDate(date.getDate() - 7);
  const dateFrom = date.toISOString().slice(0, 10);

  console.log("[call-test-collect] POST", `${BASE}/api/research/sources/test-collect`);
  console.log("[call-test-collect] body:", { source_id: sourceId, date_from: dateFrom, date_to: dateTo });

  const response = await fetch(`${BASE}/api/research/sources/test-collect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      source_id: sourceId,
      date_from: dateFrom,
      date_to: dateTo
    })
  });

  const text = await response.text();
  console.log("[call-test-collect] status:", response.status);
  console.log("[call-test-collect] response:", text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
