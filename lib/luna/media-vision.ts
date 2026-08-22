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

/** 환경변수 MEDIA_VISION_MODEL 로 덮어쓸 수 있음 */
export function mediaVisionModel(): string {
  return process.env.MEDIA_VISION_MODEL?.trim() || "claude-haiku-4-5";
}

export function resolveMediaVisionProvider(model: string): MediaVisionProvider {
  return /claude/i.test(model) ? "anthropic" : "openai";
}

/** glossary + 서술 규칙 — index·로컬 테스트 공통 */
function mediaVisionRulesBlock(glossary: MediaGlossaryTerm[]): string {
  return `[서술 규칙]
- 확실하지 않으면 "~로 추정", "~로 보인다", "~것으로 보임" 등 추측 표현을 쓰지 마라. 눈에 보이는 것만 서술하라.
- 브랜드·상호·장소명을 모르면 언급하지 마라.
- 한 description 에 아폴론 용어는 최대 2개. 확실하지 않으면 쓰지 말고 일반 한국어로 써라.
- category: 타사 사례·레퍼런스·인스피레이션·현장 사진이면 reference, 우리 시안·렌더·제작물이면 ours. 분명하면 unknown 을 쓰지 마라.

[용어 사용 조건 — 아래에 해당할 때만 glossary 용어를 쓴다]
- 공개공지: 건물 밖 야외 공간일 때만. 실내 로비·아트리움·쇼핑몰 실내에는 쓰지 마라
- 미디어파사드: 건물 외벽일 때만. 실내 스크린·벽면 디스플레이에는 쓰지 마라
- 미디어 조형물: 독립적으로 서 있는 입체 조형물일 때만
- LED 바닥 디스플레이: 바닥이 실제로 발광·LED 패널일 때만. 바닥 인쇄 포스터·스티커·매트에는 쓰지 마라

[아폴론 용어 glossary — 조건을 만족할 때만, description 전체 2개 이하]
${formatGlossaryBlock(glossary)}`;
}

export function buildMediaIndexVisionPrompt(opts: {
  fullPath: string;
  parts: MediaPathParts;
  folderCategory: string;
  glossary: MediaGlossaryTerm[];
  notionContext: string | null;
}): string {
  const variantLine =
    opts.parts.variant || opts.parts.dateToken
      ? `${opts.parts.variant ?? "-"} / ${opts.parts.dateToken ?? "-"}`
      : "-";

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
- 차수·날짜: ${variantLine}
- 폴더규칙: ${opts.folderCategory}

[프로젝트 노션 맥락 — 있으면 활용]
${opts.notionContext ?? "(없음)"}
경로·노션에 프로젝트명·단계·컨셉이 있으면 설명에 활용하라. 브랜드를 모르면 프로젝트명·경로 맥락으로 대체할 수 있다.

${mediaVisionRulesBlock(opts.glossary)}

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

${mediaVisionRulesBlock(glossary)}

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
