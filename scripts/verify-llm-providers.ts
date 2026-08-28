/**
 * OpenAI / Gemini 실호출 검증 (등급·auto_swap 변경 없음)
 *
 * 실행: npx tsx scripts/verify-llm-providers.ts
 */
import { readFileSync } from "fs";
import {
  llmComplete,
  llmStreamText,
  type LlmToolDef
} from "../lib/luna/llm/client";
import { WORKSERVER_TOOL_DEFS } from "../lib/luna/workserver-explore";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = line.slice(0, i);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const TOOLS: LlmToolDef[] = WORKSERVER_TOOL_DEFS;

function firstTwoSentences(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/(?<=[.。!?？])\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || cleaned.slice(0, 200);
}

async function testSimple(
  label: string,
  provider: "openai" | "google",
  model: string
) {
  console.log(`\n===== ${label} 1. 단순 호출 =====`);
  try {
    const res = await llmComplete({
      provider,
      model_id: model,
      system:
        "당신은 한국어로만 답하는 비서입니다. 아는 범위에서 짧게 답하세요.",
      user: "아폴론이머시브웍스는 무엇을 하는 회사인가?",
      maxTokens: 400
    });
    const ko = /[가-힣]/.test(res.text);
    console.log(ko ? "성공" : "실패(한국어 미검출)");
    console.log("첫 두 문장:", firstTwoSentences(res.text));
    console.log("usage:", JSON.stringify(res.usage));
    return { ok: ko, res };
  } catch (err) {
    console.log("실패");
    console.log(
      "에러 전문:",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, res: null };
  }
}

async function testTools(
  label: string,
  provider: "openai" | "google",
  model: string
) {
  console.log(`\n===== ${label} 2. 도구 사용 =====`);
  try {
    const res = await llmComplete({
      provider,
      model_id: model,
      system:
        "Work서버 파일 위치를 찾을 때 반드시 list_folder, search_in, search_all 중 하나 이상의 도구를 호출하세요. 추측으로 경로를 답하지 마세요.",
      user: "더후 견적서 위치 알려줘",
      maxTokens: 600,
      tools: TOOLS
    });
    if (res.toolCalls.length === 0) {
      console.log("실패(도구 미호출)");
      console.log("텍스트:", res.text.slice(0, 300));
      console.log("usage:", JSON.stringify(res.usage));
      return { ok: false, res };
    }
    console.log("성공");
    for (const tc of res.toolCalls) {
      console.log(`도구: ${tc.name}`);
      console.log(`인자: ${JSON.stringify(tc.input)}`);
    }
    console.log("usage:", JSON.stringify(res.usage));
    return { ok: true, res };
  } catch (err) {
    console.log("실패");
    console.log(
      "에러 전문:",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, res: null };
  }
}

async function testStream(
  label: string,
  provider: "openai" | "google",
  model: string
) {
  console.log(`\n===== ${label} 3. 스트리밍 (llmStreamText) =====`);
  try {
    let chunks = 0;
    let textChunks = 0;
    let usage = null as
      | {
          input_tokens: number;
          output_tokens: number;
        }
      | null;
    let assembled = "";
    for await (const part of llmStreamText({
      provider,
      model_id: model,
      system: "한국어로 한 문장만 답하세요.",
      user: "1부터 5까지 숫자만 나열해 주세요.",
      maxTokens: 100
    })) {
      chunks += 1;
      if (part.delta) {
        textChunks += 1;
        assembled += part.delta;
      }
      if (part.usage) {
        usage = {
          input_tokens: part.usage.input_tokens,
          output_tokens: part.usage.output_tokens
        };
      }
    }
    console.log(
      textChunks <= 1
        ? `성공(한 번에 수신 — textChunks=${textChunks}, totalYields=${chunks})`
        : `성공(조각 스트리밍 — textChunks=${textChunks}, totalYields=${chunks})`
    );
    console.log("조립 텍스트:", assembled.slice(0, 120));
    console.log("usage:", JSON.stringify(usage));
    console.log(
      "참고: client.ts llmStreamText 는 OpenAI/Gemini 를 non-stream complete 후 1회 emit"
    );
    return { ok: true, textChunks, chunks, usage };
  } catch (err) {
    console.log("실패");
    console.log(
      "에러 전문:",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, textChunks: 0, chunks: 0, usage: null };
  }
}

async function testRawProviderStream(
  label: string,
  provider: "openai" | "google",
  model: string
) {
  console.log(`\n===== ${label} 3b. 공급사 raw stream API =====`);
  try {
    if (provider === "openai") {
      const key = process.env.LUNA_OPENAI_API_KEY!.trim();
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          stream: true,
          max_completion_tokens: 80,
          messages: [{ role: "user", content: "Say hi in Korean in 5 words." }]
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`OpenAI stream ${res.status}: ${t.slice(0, 400)}`);
      }
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let events = 0;
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") events += 1;
        }
      }
      console.log(`성공 — SSE data 이벤트 수: ${events}`);
      return { ok: true, events };
    }

    const key = process.env.LUNA_GOOGLE_API_KEY!.trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Say hi in Korean in 5 words." }] }],
        generationConfig: { maxOutputTokens: 80 }
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Gemini stream ${res.status}: ${t.slice(0, 400)}`);
    }
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let events = 0;
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) events += 1;
      }
    }
    console.log(`성공 — SSE data 이벤트 수: ${events}`);
    return { ok: true, events };
  } catch (err) {
    console.log("실패");
    console.log(
      "에러 전문:",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, events: 0 };
  }
}

function testUsageShape(
  label: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  } | null
) {
  console.log(`\n===== ${label} 4. 토큰 사용량 형태 =====`);
  if (!usage) {
    console.log("실패 — usage 없음");
    return false;
  }
  const ok =
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number" &&
    Number.isFinite(usage.input_tokens) &&
    Number.isFinite(usage.output_tokens);
  console.log(ok ? "성공" : "실패");
  console.log(
    `input_tokens=${usage.input_tokens}, output_tokens=${usage.output_tokens}`
  );
  console.log(
    "luna_usage_daily 기록 가능 형태:",
    ok
      ? "예 (bumpUsageDaily 가 기대하는 LunaUsageTokens)"
      : "아니오"
  );
  return ok;
}

async function main() {
  const cases: Array<{
    label: string;
    provider: "openai" | "google";
    model: string;
  }> = [
    { label: "OpenAI gpt-5.6-luna", provider: "openai", model: "gpt-5.6-luna" },
    {
      label: "Gemini gemini-3.7-flash",
      provider: "google",
      model: "gemini-3.7-flash"
    }
  ];

  for (const c of cases) {
    console.log(`\n########## ${c.label} ##########`);
    const simple = await testSimple(c.label, c.provider, c.model);
    const tools = await testTools(c.label, c.provider, c.model);
    const stream = await testStream(c.label, c.provider, c.model);
    await testRawProviderStream(c.label, c.provider, c.model);
    const usage =
      simple.res?.usage ??
      tools.res?.usage ??
      (stream.usage
        ? {
            input_tokens: stream.usage.input_tokens,
            output_tokens: stream.usage.output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        : null);
    testUsageShape(c.label, usage);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
