import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LunaUsageFeature } from "@/lib/luna/brain-models";
import {
  bumpUsageDaily,
  emptyUsage,
  getTierModel,
  readUsage,
  resolveProviderModel,
  type LunaTier,
  type LunaUsageTokens,
  type ResolvedProviderModel
} from "@/lib/luna/engine";

export type LlmToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type LlmCompleteResult = {
  text: string;
  usage: LunaUsageTokens;
  toolCalls: LlmToolCall[];
  rawContent?: unknown;
  provider: ResolvedProviderModel["provider"];
  model_id: string;
  model_label: string;
};

function anthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function openaiKey(): string | null {
  return process.env.LUNA_OPENAI_API_KEY?.trim() || null;
}

function googleKey(): string | null {
  return process.env.LUNA_GOOGLE_API_KEY?.trim() || null;
}

async function completeAnthropic(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
  tools?: LlmToolDef[];
}): Promise<LlmCompleteResult> {
  const client = anthropicClient();
  if (!client) throw new Error("Claude API key is not configured");

  const res = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system?.trim() || undefined,
    tools: opts.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema
    })),
    messages: [{ role: "user", content: opts.user }]
  });

  const text =
    res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
  const toolCalls: LlmToolCall[] = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      input:
        b.input && typeof b.input === "object"
          ? (b.input as Record<string, unknown>)
          : {}
    }));

  return {
    text,
    usage: readUsage(res.usage),
    toolCalls,
    rawContent: res.content,
    provider: "anthropic",
    model_id: opts.model,
    model_label: opts.model
  };
}

async function completeOpenAI(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
  tools?: LlmToolDef[];
}): Promise<LlmCompleteResult> {
  const key = openaiKey();
  if (!key) throw new Error("OpenAI API key is not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: [
      ...(opts.system?.trim()
        ? [{ role: "system", content: opts.system.trim() }]
        : []),
      { role: "user", content: opts.user }
    ]
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 400)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  const msg = json.choices?.[0]?.message;
  const text = (msg?.content ?? "").trim();
  const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((tc) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function?.arguments || "{}") as Record<
        string,
        unknown
      >;
    } catch {
      input = {};
    }
    return {
      id: tc.id,
      name: tc.function?.name || "",
      input
    };
  });

  return {
    text,
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    },
    toolCalls,
    provider: "openai",
    model_id: opts.model,
    model_label: opts.model
  };
}

async function completeGoogle(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
  tools?: LlmToolDef[];
}): Promise<LlmCompleteResult> {
  const key = googleKey();
  if (!key) throw new Error("Gemini API key is not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: { maxOutputTokens: opts.maxTokens }
  };
  if (opts.system?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.system.trim() }] };
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }))
      }
    ];
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 400)}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text || "")
    .join("")
    .trim();
  const toolCalls: LlmToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p, i) => ({
      id: `gm_${i}_${p.functionCall!.name}`,
      name: p.functionCall!.name!,
      input: p.functionCall!.args ?? {}
    }));

  return {
    text,
    usage: {
      input_tokens: json.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    },
    toolCalls,
    provider: "google",
    model_id: opts.model,
    model_label: opts.model
  };
}

export async function llmComplete(opts: {
  provider: ResolvedProviderModel["provider"];
  model_id: string;
  model_label?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  tools?: LlmToolDef[];
}): Promise<LlmCompleteResult> {
  const maxTokens = opts.maxTokens ?? 2048;
  let result: LlmCompleteResult;
  if (opts.provider === "openai") {
    result = await completeOpenAI({
      model: opts.model_id,
      system: opts.system,
      user: opts.user,
      maxTokens,
      tools: opts.tools
    });
  } else if (opts.provider === "google") {
    result = await completeGoogle({
      model: opts.model_id,
      system: opts.system,
      user: opts.user,
      maxTokens,
      tools: opts.tools
    });
  } else {
    result = await completeAnthropic({
      model: opts.model_id,
      system: opts.system,
      user: opts.user,
      maxTokens,
      tools: opts.tools
    });
  }
  return {
    ...result,
    model_label: opts.model_label ?? result.model_label
  };
}

/** 등급 조회 + 공급사 해석 + 완료 + 사용량 기록 */
export async function lunaLlmComplete(
  admin: SupabaseClient,
  opts: {
    tier: LunaTier;
    feature: LunaUsageFeature;
    system?: string;
    user: string;
    maxTokens?: number;
    tools?: LlmToolDef[];
  }
): Promise<LlmCompleteResult> {
  const tierModel = await getTierModel(admin, opts.tier);
  const resolved = resolveProviderModel(tierModel);
  const result = await llmComplete({
    provider: resolved.provider,
    model_id: resolved.model_id,
    model_label: resolved.model_label,
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens,
    tools: opts.tools
  });
  bumpUsageDaily(admin, {
    tier: opts.tier,
    model_id: result.model_id,
    usage: result.usage,
    feature: opts.feature
  });
  return result;
}

export async function* llmStreamText(opts: {
  provider: ResolvedProviderModel["provider"];
  model_id: string;
  system?: string;
  user: string;
  maxTokens?: number;
}): AsyncGenerator<{ delta: string; usage?: LunaUsageTokens }> {
  const maxTokens = opts.maxTokens ?? 4096;

  if (opts.provider === "anthropic") {
    const client = anthropicClient();
    if (!client) throw new Error("Claude API key is not configured");
    const stream = client.messages.stream({
      model: opts.model_id,
      max_tokens: maxTokens,
      system: opts.system?.trim() || undefined,
      messages: [{ role: "user", content: opts.user }]
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { delta: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    yield { delta: "", usage: readUsage(final.usage) };
    return;
  }

  // OpenAI / Gemini: non-stream complete then emit once (도구·스트리밍 동시 요구가 없는 경로용)
  const full = await llmComplete({
    provider: opts.provider,
    model_id: opts.model_id,
    system: opts.system,
    user: opts.user,
    maxTokens
  });
  if (full.text) yield { delta: full.text };
  yield { delta: "", usage: full.usage };
}

export { emptyUsage, anthropicClient };
