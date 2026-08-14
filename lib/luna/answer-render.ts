import { parseAssumeMarkers, parseNumberedChoices } from "./chat-response";
import {
  splitMarkdownByWorkserverPaths,
  type MarkdownSegment
} from "./nas-path";

export type ParsedLunaAnswer = {
  markdown: string;
  assumptions: string[];
  segments: MarkdownSegment[];
};

export function parseLunaAnswer(raw: string): ParsedLunaAnswer {
  const numbered = parseNumberedChoices(raw);
  const base = numbered ? numbered.body : raw;
  const { body, assumptions } = parseAssumeMarkers(base);
  const markdown = body || (assumptions.length === 0 ? raw : "");
  let segments: MarkdownSegment[];
  try {
    segments = markdown
      ? splitMarkdownByWorkserverPaths(markdown)
      : [];
  } catch (err) {
    console.warn("[luna-render] path split failed", err);
    segments = markdown ? [{ type: "text", value: markdown }] : [];
  }
  return { markdown, assumptions, segments };
}

/** @deprecated parseLunaAnswer 사용 */
export function prepareLunaAnswerMarkdown(raw: string): {
  markdown: string;
  assumptions: string[];
} {
  const parsed = parseLunaAnswer(raw);
  return { markdown: parsed.markdown, assumptions: parsed.assumptions };
}
