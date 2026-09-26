/** Citation markers identify retrieved records; they do not prove semantic support. */
export function notionCitationMarker(id: string): string {
  const normalized = id.replace(/-/g, "").toLowerCase();
  return /^[a-f0-9]{32}$/.test(normalized)
    ? `<!--luna-source:notion:${normalized}-->` : "";
}

export function citedNotionIds(answer: string): Set<string> {
  // Ignore examples inside fenced code blocks.
  const prose = answer.replace(/```[\s\S]*?```/g, "");
  return new Set([...prose.matchAll(/<!--luna-source:notion:([a-f0-9]{32})-->/g)]
    .map(match => match[1]!));
}

export function hasNotionCitation(answer: string, id: string): boolean {
  const marker = notionCitationMarker(id);
  return Boolean(marker) && citedNotionIds(answer).has(id.replace(/-/g, "").toLowerCase());
}

/** Internal attribution stays in stored answers, but not in copied user-facing text. */
export function stripLunaSourceMarkers(answer: string): string {
  return answer.replace(/<!--luna-source:notion:[a-f0-9]{32}-->/g, "");
}
