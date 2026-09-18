import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openaiApiKey } from "@/lib/luna/env-keys";
import { bumpUsageDaily } from "@/lib/luna/engine";
import { getSttHintPrompt } from "@/lib/luna/stt-prompt";

export const STT_MODEL = "gpt-4o-transcribe";
export const STT_FEATURE = "luna_stt";
/** $0.006 / minute */
const USD_PER_SECOND = 0.006 / 60;

export type TranscribeResult = {
  text: string;
  seconds: number;
  prompt: string;
};

function kstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function recordSttUsage(
  admin: SupabaseClient,
  seconds: number,
  userId: string | null
): Promise<void> {
  const safeSec = Math.max(1, Math.round(seconds));
  const addCost = safeSec * USD_PER_SECOND;
  const date = kstDate();
  bumpUsageDaily(admin, {
    tier: "C",
    model_id: STT_MODEL,
    usage: {
      input_tokens: safeSec,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    },
    feature: STT_FEATURE
  });

  const match = {
    provider: "openai",
    date,
    model: STT_MODEL,
    api_key_label: STT_FEATURE,
    workspace_name: "luna"
  };
  const { data: existing } = await admin
    .from("api_usage")
    .select("id, input_tokens, cost_usd, num_requests, workflow_name")
    .match(match)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("api_usage")
      .update({
        input_tokens: Number(existing.input_tokens ?? 0) + safeSec,
        cost_usd: Number(existing.cost_usd ?? 0) + addCost,
        input_cost_usd: Number(existing.cost_usd ?? 0) + addCost,
        num_requests: (existing.num_requests ?? 0) + 1,
        workflow_name: STT_FEATURE,
        uploaded_by: userId
      })
      .eq("id", existing.id);
    if (error) console.error("[luna/stt] api_usage update", error);
    return;
  }

  const { error } = await admin.from("api_usage").insert({
    ...match,
    input_tokens: safeSec,
    output_tokens: 0,
    total_tokens: safeSec,
    cost_usd: addCost,
    input_cost_usd: addCost,
    output_cost_usd: 0,
    num_requests: 1,
    workflow_name: STT_FEATURE,
    uploaded_by: userId
  });
  if (error) console.error("[luna/stt] api_usage insert", error);
}

export async function transcribeAudio(opts: {
  admin: SupabaseClient;
  file: Blob;
  filename: string;
  seconds?: number;
  userId?: string | null;
}): Promise<TranscribeResult> {
  const key = openaiApiKey();
  if (!key) throw new Error("OpenAI 키가 없습니다");

  const prompt = await getSttHintPrompt(opts.admin);
  const form = new FormData();
  form.append("file", opts.file, opts.filename || "audio.webm");
  form.append("model", STT_MODEL);
  form.append("language", "ko");
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (prompt) form.append("prompt", prompt);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body.slice(0, 300) || `transcribe ${res.status}`);
  }
  const json = (await res.json()) as { text?: string; duration?: number };
  const text = typeof json.text === "string" ? json.text.trim() : "";
  const seconds =
    typeof json.duration === "number" && Number.isFinite(json.duration)
      ? json.duration
      : opts.seconds ?? 1;

  await recordSttUsage(opts.admin, seconds, opts.userId ?? null);
  return { text, seconds, prompt };
}
