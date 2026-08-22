/**
 * 미디어 비전 API — OpenAI / Anthropic 공통.
 * scripts/vision-model-compare.ts · lib/luna/media-vision.ts 가 공유한다.
 */
import Anthropic from "@anthropic-ai/sdk";

export type VisionApiResult = {
  text: string;
  input_tokens: number;
  output_tokens: number;
};

/** LUNA 답변과 동일 — lib/luna/llm/client.ts */
export function lunaAnthropicApiKey(): string | null {
  return (
    process.env.hubtrendchat_claude?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    null
  );
}

export function lunaOpenAiApiKey(): string | null {
  return (
    process.env.LUNA_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null
  );
}

function openAiMaxTokensField(
  model: string
): "max_completion_tokens" | "max_tokens" {
  return /^gpt-5|^o[1-4]|codex/i.test(model)
    ? "max_completion_tokens"
    : "max_tokens";
}

export function formatVisionApiError(
  provider: "openai" | "anthropic",
  model: string,
  err: unknown
): string {
  if (err instanceof Anthropic.APIError) {
    const body =
      typeof err.error === "object" && err.error != null
        ? JSON.stringify(err.error).slice(0, 400)
        : String(err.error ?? "").slice(0, 400);
    return `${provider} ${model} HTTP ${err.status}: ${err.message}${body ? ` · ${body}` : ""}`;
  }
  if (err instanceof Error) {
    return `${provider} ${model}: ${err.message}`;
  }
  return `${provider} ${model}: ${String(err)}`;
}

export async function callAnthropicVision(opts: {
  model: string;
  prompt: string;
  jpegBase64: string;
  maxTokens?: number;
}): Promise<VisionApiResult> {
  const key = lunaAnthropicApiKey();
  if (!key) {
    throw new Error(
      "anthropic key missing (hubtrendchat_claude or ANTHROPIC_API_KEY)"
    );
  }

  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 700,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: opts.jpegBase64
              }
            },
            { type: "text", text: opts.prompt }
          ]
        }
      ]
    });
    const text =
      res.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    return {
      text,
      input_tokens: res.usage?.input_tokens ?? 0,
      output_tokens: res.usage?.output_tokens ?? 0
    };
  } catch (err) {
    throw new Error(formatVisionApiError("anthropic", opts.model, err));
  }
}

export async function callOpenAiVision(opts: {
  model: string;
  prompt: string;
  jpegBase64: string;
  maxTokens?: number;
}): Promise<VisionApiResult> {
  const key = lunaOpenAiApiKey();
  if (!key) {
    throw new Error("openai key missing (LUNA_OPENAI_API_KEY)");
  }

  const maxTokens = opts.maxTokens ?? 700;
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${opts.jpegBase64}`,
              detail: "low"
            }
          }
        ]
      }
    ]
  };
  body[openAiMaxTokensField(opts.model)] = maxTokens;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `openai ${opts.model} HTTP ${res.status}: ${errBody.slice(0, 400)}`
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    input_tokens: json.usage?.prompt_tokens ?? 0,
    output_tokens: json.usage?.completion_tokens ?? 0
  };
}
