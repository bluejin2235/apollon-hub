import { parseAssumeMarkers, parseNumberedChoices } from "@/lib/luna/chat-response";

export function prepareLunaAnswerMarkdown(raw: string): {
  markdown: string;
  assumptions: string[];
} {
  const numbered = parseNumberedChoices(raw);
  const base = numbered ? numbered.body : raw;
  const { body, assumptions } = parseAssumeMarkers(base);
  const markdown = body || (assumptions.length === 0 ? raw : "");
  return { markdown, assumptions };
}
