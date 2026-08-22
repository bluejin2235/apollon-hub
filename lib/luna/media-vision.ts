import type { MediaPathParts } from "@/lib/luna/media-path-parse";
import {
  formatGlossaryBlock,
  type MediaGlossaryTerm
} from "@/lib/luna/media-vision-prompt";

export type MediaIndexVisionOutput = {
  description: string;
  category: "ours" | "reference" | "unknown";
  purpose: string;
  author: string;
};

export type MediaVisionUsage = {
  inputTokens: number;
  outputTokens: number;
};

function openaiKey(): string | null {
  return process.env.LUNA_OPENAI_API_KEY?.trim() || null;
}

export function mediaVisionModel(): string {
  return process.env.MEDIA_VISION_MODEL?.trim() || "gpt-5.6-luna";
}

/** gpt-5 / o-series 는 max_completion_tokens (lib/luna/llm/client.ts 와 동일) */
function openAiMaxTokensField(model: string): "max_completion_tokens" | "max_tokens" {
  return /^gpt-5|^o[1-4]|codex/i.test(model)
    ? "max_completion_tokens"
    : "max_tokens";
}

export function buildMediaIndexVisionPrompt(opts: {
  fullPath: string;
  parts: MediaPathParts;
  folderCategory: string;
  glossary: MediaGlossaryTerm[];
  notionContext: string | null;
}): string {
  return `당신은 아폴론(미디어·공간 디자인) 아카이브 사서다. 이미지를 보고 JSON만 답한다.

[전체 경로]
${opts.fullPath}

[경로 해석]
${opts.parts.summary}
- 최상위: ${opts.parts.rootClass ?? "-"} (01 사업개발=제안, 02 Project=수행, 03 R&D, 07 마케팅)
- 연도: ${opts.parts.year ?? "-"}
- 프로젝트: ${opts.parts.project ?? "-"}
- 단계: ${opts.parts.stageCode ?? "-"} ${opts.parts.stageName ?? "-"}
- 주체: ${opts.parts.actor ?? "-"} (${opts.parts.actorKind ?? "-"})
- 폴더규칙: ${opts.folderCategory}

[프로젝트 노션 맥락 — 있으면 활용, 없으면 무시]
${opts.notionContext ?? "(없음)"}

[아폴론 용어 — 해당하는 용어가 있으면 쓰되 억지로 끼워넣지 마라]
${formatGlossaryBlock(opts.glossary)}

category 후보: ours(우리 시안·제작) | reference(레퍼런스·사례) | unknown

JSON:
{
  "description": "한국어 100~200자. 무엇이 보이나·공간·색·형태·재질",
  "category": "ours|reference|unknown",
  "purpose": "용도 한 줄 (경로 해석 + 이미지)",
  "author": "주체 (아폴론/협력사명/이니셜/한글 이름)"
}`;
}

export function parseMediaIndexVisionJson(text: string): MediaIndexVisionOutput {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      description: t.slice(0, 240),
      category: "unknown",
      purpose: "",
      author: ""
    };
  }
  try {
    const v = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    const rawCat = String(v.category ?? "unknown").toLowerCase();
    const category =
      rawCat === "ours" || rawCat === "reference" ? rawCat : "unknown";
    return {
      description: String(v.description ?? "").slice(0, 400),
      category,
      purpose: String(v.purpose ?? "").slice(0, 200),
      author: String(v.author ?? "").slice(0, 80)
    };
  } catch {
    return {
      description: t.slice(0, 240),
      category: "unknown",
      purpose: "",
      author: ""
    };
  }
}

export async function analyzeMediaImageVision(
  jpegBase64: string,
  prompt: string
): Promise<{ result: MediaIndexVisionOutput; usage: MediaVisionUsage }> {
  const key = openaiKey();
  if (!key) throw new Error("LUNA_OPENAI_API_KEY missing");

  const model = mediaVisionModel();
  const maxTokens = 600;
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${jpegBase64}`,
              detail: "low"
            }
          }
        ]
      }
    ]
  };
  body[openAiMaxTokensField(model)] = maxTokens;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vision ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    result: parseMediaIndexVisionJson(text),
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0
    }
  };
}
