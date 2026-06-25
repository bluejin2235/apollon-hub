/**
 * Debug script for test-collect web search flow.
 * Usage: node scripts/debug-test-collect.mjs [source_id]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const GPT_CURATOR_PROMPT_KEY = "gpt_curator_prompt";
const DEFAULT_GPT_CURATOR_PROMPT = `너는 아폴론이머시브웍스의 트렌드 큐레이터야.
반드시 JSON 배열만 응답해.`;

function buildWebSearchPrompt(siteUrl, promptTemplate, dateRange) {
  const dateHint = dateRange
    ? `\n수집 기간: ${dateRange.from.toISOString().slice(0, 10)} ~ ${dateRange.to.toISOString().slice(0, 10)}`
    : "\n최신 기사 위주로 검색해줘.";

  return `다음 사이트에서 아폴론이머시브웍스와 관련된 기사를 웹검색으로 찾아줘: ${siteUrl}
${dateHint}

${promptTemplate.trim()}

웹검색 후 결과를 반드시 아래 JSON 배열 형식으로만 응답해. 다른 텍스트 없이.
[{"title": "기사 제목", "url": "https://...", "description": "요약", "published_at": "2025-01-15T00:00:00Z"}]
기사 없으면: []`;
}

function extractResponseText(payload) {
  console.log("[debug] extractResponseText: output_text?", Boolean(payload.output_text?.trim()));
  console.log("[debug] extractResponseText: output count =", payload.output?.length ?? 0);
  for (const [i, item] of (payload.output ?? []).entries()) {
    console.log(`[debug] output[${i}] type=${item.type}`);
    if (item.type?.includes("web_search")) {
      console.log(`[debug] output[${i}]`, JSON.stringify(item).slice(0, 800));
    }
  }
  if (payload.output_text?.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && block.text?.trim()) parts.push(block.text.trim());
    }
  }
  return parts.join("\n").trim();
}

async function main() {
  const apiKey = process.env.hubtrendchat_chatgpt;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  console.log("[debug] env: apiKey =", Boolean(apiKey), "supabase =", Boolean(supabaseUrl && secretKey));

  if (!apiKey) {
    console.error("hubtrendchat_chatgpt not set");
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let sourceId = process.argv[2];
  if (!sourceId) {
    const { data, error } = await admin
      .from("trend_sources")
      .select("id, name, url")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data?.[0]) {
      console.error("No trend_sources found:", error?.message);
      process.exit(1);
    }
    sourceId = data[0].id;
    console.log("[debug] using first source:", data[0].name, data[0].url, sourceId);
  }

  const { data: source, error: sourceError } = await admin
    .from("trend_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle();

  if (sourceError || !source) {
    console.error("Source load failed:", sourceError?.message);
    process.exit(1);
  }

  const { data: setting } = await admin
    .from("trend_settings")
    .select("value")
    .eq("key", GPT_CURATOR_PROMPT_KEY)
    .maybeSingle();

  const promptTemplate = source.gpt_prompt?.trim() || setting?.value?.trim() || DEFAULT_GPT_CURATOR_PROMPT;
  const siteUrl = source.url?.trim();
  const input = buildWebSearchPrompt(siteUrl, promptTemplate, null);

  console.log("\n=== STEP 1: OpenAI request ===");
  console.log("siteUrl:", siteUrl);
  console.log("prompt preview:", input.slice(0, 400));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input
    })
  });

  console.log("\n=== STEP 2: response status ===", response.status, response.statusText);
  const rawBody = await response.text();
  console.log("\n=== STEP 3: raw body (first 4000 chars) ===\n", rawBody.slice(0, 4000));

  if (!response.ok) {
    process.exit(1);
  }

  const payload = JSON.parse(rawBody);
  const webCalls = (payload.output ?? []).filter((o) => String(o.type).includes("web_search"));
  console.log("\n=== STEP 4: web_search items ===", webCalls.length);

  const text = extractResponseText(payload);
  console.log("\n=== STEP 5: extracted text (first 2000 chars) ===\n", text.slice(0, 2000));

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  console.log("\n=== STEP 6: json match found? ===", Boolean(jsonMatch));
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      console.log("parsed array length:", arr.length);
      console.log("first item:", JSON.stringify(arr[0] ?? null));
    } catch (e) {
      console.error("JSON parse error:", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
