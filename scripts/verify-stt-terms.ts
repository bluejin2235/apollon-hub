/**
 * gpt-4o-transcribe 가 아폴론 용어를 받는지 TTS → 받아쓰기 비교.
 * npx tsx --require ./scripts/stub-server-only.cjs --env-file=.env.local scripts/verify-stt-terms.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { openaiApiKey } from "../lib/luna/env-keys";
import { getSttHintPrompt } from "../lib/luna/stt-prompt";
import { transcribeAudio } from "../lib/luna/transcribe";

const PHRASES = ["볼팍견적", "인스파이어 시즌4"];

async function tts(text: string, key: string): Promise<Blob> {
  const attempts: Array<Record<string, unknown>> = [
    {
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      instructions: "한국어로 또박또박. 고유명사 음절을 분명히 발음한다.",
      response_format: "mp3"
    },
    {
      model: "tts-1-hd",
      voice: "nova",
      input: `${text}. ${text}.`,
      speed: 0.85,
      response_format: "mp3"
    }
  ];
  let last = "";
  for (const body of attempts) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
    }
    last = await res.text();
  }
  throw new Error(last || "tts failed");
}

async function transcribeRaw(
  key: string,
  file: Blob,
  prompt: string | null
): Promise<string> {
  const form = new FormData();
  form.append("file", file, "speech.mp3");
  form.append("model", "gpt-4o-transcribe");
  form.append("language", "ko");
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (prompt) form.append("prompt", prompt);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form
  });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

function matches(got: string, phrase: string): boolean {
  const g = got.replace(/\s/g, "");
  const p = phrase.replace(/\s/g, "");
  if (g.includes(p)) return true;
  if (p === "볼팍견적") return g.includes("볼팍") && g.includes("견적");
  if (p === "인스파이어시즌4") {
    return g.includes("인스파이어") && (g.includes("시즌4") || g.includes("시즌"));
  }
  return false;
}

async function main() {
  const key = openaiApiKey();
  if (!key) throw new Error("OPENAI key missing");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const prompt = await getSttHintPrompt(admin);
  console.log("prompt:", prompt);
  console.log("len:", prompt.length);

  let failed = 0;
  for (const phrase of PHRASES) {
    const audio = await tts(phrase, key);
    const withPrompt = await transcribeRaw(key, audio, prompt);
    const without = await transcribeRaw(key, audio, null);
    const viaLib = await transcribeAudio({
      admin,
      file: audio,
      filename: "speech.mp3",
      seconds: 2
    });
    const ok = matches(withPrompt, phrase) || matches(viaLib.text, phrase);
    console.log(`\n말한 것: ${phrase}`);
    console.log(`  프롬프트 있음: ${withPrompt}`);
    console.log(`  프롬프트 없음: ${without}`);
    console.log(`  transcribeAudio: ${viaLib.text}`);
    console.log(ok ? "  ✓ 용어 포함" : "  ✗ 용어 불일치");
    if (!ok) failed += 1;
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
