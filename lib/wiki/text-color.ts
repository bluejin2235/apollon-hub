export const WIKI_PRESET_TEXT_COLORS = [
  { hex: "#b0231e", label: "빨강" },
  { hex: "#a35a08", label: "주황" },
  { hex: "#0f7a45", label: "초록" },
  { hex: "#534AB7", label: "보라" },
  { hex: "#2563a8", label: "파랑" },
  { hex: "#0e7490", label: "청록" },
  { hex: "#6b7280", label: "회색" },
  { hex: "#16181d", label: "검정" }
] as const;

const RECENT_KEY = "wiki-recent-text-colors";
const MAX_RECENT = 5;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_WRAP_RE = /^\[color=(#[0-9a-fA-F]{6})\]([\s\S]*)\[\/color\]$/;

export function isValidWikiHexColor(color: string): boolean {
  return HEX_RE.test(color);
}

export function normalizeWikiHexColor(color: string): string {
  return color.toLowerCase();
}

export function getRecentWikiTextColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && isValidWikiHexColor(item))
      .map(normalizeWikiHexColor)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberWikiTextColor(color: string) {
  if (!isValidWikiHexColor(color) || typeof window === "undefined") return;
  const hex = normalizeWikiHexColor(color);
  const next = [hex, ...getRecentWikiTextColors().filter((item) => item !== hex)].slice(
    0,
    MAX_RECENT
  );
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function stripWikiColorTags(text: string): string {
  return text.replace(/\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/gi, "$2");
}

export function applyWikiTextColorToSelection(
  value: string,
  start: number,
  end: number,
  hex: string
): { next: string; selectionStart: number; selectionEnd: number } {
  if (!isValidWikiHexColor(hex)) {
    throw new Error("invalid color");
  }
  const color = normalizeWikiHexColor(hex);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);

  if (selected) {
    const wrappedMatch = selected.match(COLOR_WRAP_RE);
    const inner = wrappedMatch ? wrappedMatch[2]! : selected;
    const wrapped = `[color=${color}]${inner}[/color]`;
    return {
      next: before + wrapped + after,
      selectionStart: start,
      selectionEnd: start + wrapped.length
    };
  }

  const open = `[color=${color}]`;
  const close = "[/color]";
  const insert = `${open}${close}`;
  const cursor = start + open.length;
  return {
    next: before + insert + after,
    selectionStart: cursor,
    selectionEnd: cursor
  };
}

export function removeWikiTextColorFromSelection(
  value: string,
  start: number,
  end: number
): { next: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);
  const stripped = stripWikiColorTags(selected);
  return {
    next: before + stripped + after,
    selectionStart: start,
    selectionEnd: start + stripped.length
  };
}
