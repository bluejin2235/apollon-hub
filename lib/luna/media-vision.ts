import type { MediaPathParts } from "@/lib/luna/media-path-parse";
import {
  callAnthropicVision,
  callOpenAiVision
} from "@/lib/luna/media-vision-api";
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

export type MediaVisionProvider = "openai" | "anthropic";

export function mediaVisionModel(): string {
  return process.env.MEDIA_VISION_MODEL?.trim() || "gpt-5.6-luna";
}

export function resolveMediaVisionProvider(model: string): MediaVisionProvider {
  return /claude/i.test(model) ? "anthropic" : "openai";
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

/** 로컬 테스트 — 경로·노션 맥락 없이 이미지만 */
export function buildLocalImageTestVisionPrompt(
  glossary: MediaGlossaryTerm[],
  fileName?: string
): string {
  return `당신은 아폴론(미디어·공간 디자인) 아카이브 사서다. 이미지를 보고 JSON만 답한다.

[파일]
${fileName ?? "로컬 테스트 이미지"} (프로젝트·경로·노션 맥락 없음)

[아폴론 용어 — 해당하는 용어가 있으면 쓰되 억지로 끼워넣지 마라]
${formatGlossaryBlock(glossary)}

category 후보: ours(우리 시안·제작) | reference(레퍼런스·사례) | unknown

JSON:
{
  "description": "한국어 100~200자. 무엇이 보이나·공간·색·형태·재질",
  "category": "ours|reference|unknown",
  "purpose": "용도 한 줄",
  "author": "주체 (알 수 없으면 빈 문자열)"
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
  prompt: string,
  opts?: { model?: string; maxTokens?: number }
): Promise<{ result: MediaIndexVisionOutput; usage: MediaVisionUsage }> {
  const model = opts?.model ?? mediaVisionModel();
  const maxTokens = opts?.maxTokens ?? 1024;
  const api =
    resolveMediaVisionProvider(model) === "anthropic"
      ? await callAnthropicVision({
          model,
          prompt,
          jpegBase64,
          maxTokens
        })
      : await callOpenAiVision({
          model,
          prompt,
          jpegBase64,
          maxTokens
        });

  return {
    result: parseMediaIndexVisionJson(api.text),
    usage: {
      inputTokens: api.input_tokens,
      outputTokens: api.output_tokens
    }
  };
}
