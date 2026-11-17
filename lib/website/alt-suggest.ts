import "server-only";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { bumpUsageDaily } from "@/lib/luna/engine";
import { callAnthropicVision } from "@/lib/luna/media-vision-api";
import type {
  AltSuggestContext,
  AltSuggestKind,
  AltSuggestResult
} from "@/lib/website/alt-suggest-types";
import { validateAltSuggestion } from "@/lib/website/alt-suggest-validate";
import { isAllowedWebsiteImageUrl } from "@/lib/website/alt-suggest-url";

export type { AltSuggestContext, AltSuggestKind, AltSuggestResult };
export { validateAltSuggestion, isAllowedWebsiteImageUrl };

const FEATURE = "website_alt";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 20_000;
const VISION_MAX_PX = 800;

/** Sonnet 5.5: $2 / MTok in, $10 / MTok out */
const USD_PER_M_IN = 2;
const USD_PER_M_OUT = 10;

export function altSuggestModel(): string {
  return process.env.WEBSITE_ALT_MODEL?.trim() || DEFAULT_MODEL;
}

function buildPrompt(context: AltSuggestContext): string {
  const lines = [
    "You write bilingual image alt text for Apollon Immersive Works website (media architecture / LED facade / projection / sculpture).",
    "Return ONLY JSON: {\"ko\":\"...\",\"en\":\"...\"}",
    "Rules:",
    "- Describe what is visibly in the image: what object (media facade, LED, sculpture, projection, etc.), where (building exterior, lobby, plaza, etc.), and the scene.",
    "- Use title/location only when they clearly match the image.",
    "- Korean: 20–80 characters, one sentence, no trailing period.",
    "- English: 40–125 characters, one natural English sentence (not translationese), no Hangul, no trailing period.",
    "- Do not start with 이미지/사진/image/photo/picture or end Korean with 「의 모습」.",
    "- Do not use: 스튜디오, em dash (—), 최고/유일/최초, partner/client names (except proper nouns already in the title).",
    "- Do not invent year, award, or numbers not visible in the image.",
    "",
    `Content type: ${context.kind === "work" ? "work (project)" : "insight (article)"}`,
    `Title KO: ${context.titleKo?.trim() || "(none)"}`,
    `Title EN: ${context.titleEn?.trim() || "(none)"}`,
    `Category: ${context.category?.trim() || "(none)"}`,
    `Location city: ${context.locationCity?.trim() || "(none)"}`,
    `Location country: ${context.locationCountry?.trim() || "(none)"}`,
    `Section: ${context.sectionTitle?.trim() || "(none)"}`,
    `File name: ${context.fileName?.trim() || "(none)"}`
  ];
  return lines.join("\n");
}

function parseJsonAlt(text: string): { ko?: string; en?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as { ko?: string; en?: string };
  } catch {
    return null;
  }
}

async function fetchImageAsJpegBase64(imageUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { Accept: "image/*" }
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 32) return null;
    const jpeg = await sharp(buf)
      .rotate()
      .resize({
        width: VISION_MAX_PX,
        height: VISION_MAX_PX,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return jpeg.toString("base64");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hubAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function recordAltUsage(model: string, inputTokens: number, outputTokens: number) {
  const admin = hubAdminClient();
  if (!admin) return;
  bumpUsageDaily(admin, {
    tier: "B",
    model_id: model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    },
    feature: FEATURE
  });
}

export function estimateAltCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * USD_PER_M_IN + outputTokens * USD_PER_M_OUT) / 1_000_000;
}

/**
 * 이미지 URL을 보고 국·영 대체 텍스트를 제안한다.
 * 실패·검증 실패·키 없음 → null. 에러에 키·이미지 원문을 넣지 않는다.
 */
export async function suggestAlt(opts: {
  imageUrl: string;
  context: AltSuggestContext;
}): Promise<AltSuggestResult | null> {
  const imageUrl = opts.imageUrl.trim();
  if (!isAllowedWebsiteImageUrl(imageUrl)) return null;

  const jpegBase64 = await fetchImageAsJpegBase64(imageUrl);
  if (!jpegBase64) return null;

  const model = altSuggestModel();
  const prompt = buildPrompt(opts.context);

  let apiText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const result = await Promise.race([
      callAnthropicVision({
        model,
        prompt,
        jpegBase64,
        maxTokens: 300
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      })
    ]);
    apiText = result.text;
    inputTokens = result.input_tokens;
    outputTokens = result.output_tokens;
  } catch {
    return null;
  }

  if (inputTokens || outputTokens) {
    recordAltUsage(model, inputTokens, outputTokens);
  }

  const parsed = parseJsonAlt(apiText);
  if (!parsed) return null;
  return validateAltSuggestion(
    typeof parsed.ko === "string" ? parsed.ko : "",
    typeof parsed.en === "string" ? parsed.en : ""
  );
}
