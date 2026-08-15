import "server-only";
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
import { lunaNotify } from "@/lib/luna/notify";

/** C등급 GPT 실패 시 즉시 대체 */
const C_TIER_FALLBACK: ResolvedProviderModel = {
  provider: "anthropic",
  model_id: "claude-haiku-4-5-20251001",
  model_label: "Claude Haiku 4.5"
};

const LLM_FETCH_TIMEOUT_MS = 120_000;

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
    messages: [
      ...(opts.system?.trim()
        ? [{ role: "system", content: opts.system.trim() }]
        : []),
      { role: "user", content: opts.user }
    ]
  };
  // gpt-5 / o-series 등은 max_tokens 거부 → max_completion_tokens
  if (/^gpt-5|^o[1-4]|codex/i.test(opts.model)) {
    body.max_completion_tokens = opts.maxTokens;
  } else {
    body.max_tokens = opts.maxTokens;
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
    // gpt-5.6-luna 등: chat/completions + tools 시 reasoning_effort 필요
    if (/^gpt-5|^o[1-4]/i.test(opts.model)) {
      body.reasoning_effort = "none";
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS)
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS)
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

/** 등급 조회 + 공급사 해석 + 완료 + 사용량 기록. C등급은 실패 시 Haiku 폴백. */
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

  try {
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
  } catch (err) {
    if (opts.tier !== "C" || !isRetryableLlmFailure(err)) {
      throw err;
    }
    const reason = fallbackReasonLabel(err);
    console.warn(
      `[luna/llm] C등급 ${resolved.provider}/${resolved.model_id} 실패 → Haiku 폴백 (${reason})`,
      err
    );
    void lunaNotify(
      admin,
      "prompt_change",
      "C등급 폴백",
      `C등급 GPT 호출 실패 — Haiku로 대체했어요 (사유: ${reason})`,
      {
        level: "warn",
        meta: {
          c_tier_fallback: true,
          reason,
          from_provider: resolved.provider,
          from_model_id: resolved.model_id,
          feature: opts.feature
        }
      }
    );

    const result = await llmComplete({
      provider: C_TIER_FALLBACK.provider,
      model_id: C_TIER_FALLBACK.model_id,
      model_label: C_TIER_FALLBACK.model_label,
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
    return {
      ...result,
      model_label: `${result.model_label} (C폴백)`
    };
  }
}

function applyOpenAiTokenLimit(
  body: Record<string, unknown>,
  model: string,
  maxTokens: number
): void {
  if (/^gpt-5|^o[1-4]|codex/i.test(model)) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }
}

async function* streamOpenAI(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
}): AsyncGenerator<{ delta: string; usage?: LunaUsageTokens }> {
  const key = openaiKey();
  if (!key) throw new Error("OpenAI API key is not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      ...(opts.system?.trim()
        ? [{ role: "system", content: opts.system.trim() }]
        : []),
      { role: "user", content: opts.user }
    ]
  };
  applyOpenAiTokenLimit(body, opts.model, opts.maxTokens);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 400)}`);
  }
  if (!response.body) throw new Error("OpenAI stream: empty body");

  let usage: LunaUsageTokens | undefined;
  for await (const data of readSseDataLines(response.body)) {
    if (data === "[DONE]") break;
    let json: {
      choices?: Array<{ delta?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      yield { delta };
    }
    if (json.usage) {
      usage = {
        input_tokens: json.usage.prompt_tokens ?? 0,
        output_tokens: json.usage.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      };
    }
  }
  yield { delta: "", usage: usage ?? emptyUsage() };
}

async function* streamGoogle(opts: {
  model: string;
  system?: string;
  user: string;
  maxTokens: number;
}): AsyncGenerator<{ delta: string; usage?: LunaUsageTokens }> {
  const key = googleKey();
  if (!key) throw new Error("Gemini API key is not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: { maxOutputTokens: opts.maxTokens }
  };
  if (opts.system?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.system.trim() }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 400)}`);
  }
  if (!response.body) throw new Error("Gemini stream: empty body");

  let usage: LunaUsageTokens | undefined;
  for await (const data of readSseDataLines(response.body)) {
    let json: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      continue;
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text.length > 0) {
        yield { delta: p.text };
      }
    }
    if (json.usageMetadata) {
      usage = {
        input_tokens: json.usageMetadata.promptTokenCount ?? 0,
        output_tokens: json.usageMetadata.candidatesTokenCount ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      };
    }
  }
  yield { delta: "", usage: usage ?? emptyUsage() };
}

/** SSE `data:` 줄을 한 줄씩 yield */
async function* readSseDataLines(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trimEnd();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trimStart();
        if (payload) yield payload;
      }
    }
    if (buffer.trim().startsWith("data:")) {
      const payload = buffer.trim().slice(5).trimStart();
      if (payload) yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

export function isRetryableLlmFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    const msg = err.message;
    if (/\b(429|503)\b/.test(msg)) return true;
    if (/timeout|timed out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function fallbackReasonLabel(err: unknown): string {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "타임아웃";
  }
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return "타임아웃";
    }
    const m = err.message.match(/\b(429|503)\b/);
    if (m) return m[1]!;
    if (/timeout|timed out|ETIMEDOUT/i.test(err.message)) return "타임아웃";
  }
  return "오류";
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

  if (opts.provider === "openai") {
    yield* streamOpenAI({
      model: opts.model_id,
      system: opts.system,
      user: opts.user,
      maxTokens
    });
    return;
  }

  yield* streamGoogle({
    model: opts.model_id,
    system: opts.system,
    user: opts.user,
    maxTokens
  });
}

export { emptyUsage, anthropicClient };
