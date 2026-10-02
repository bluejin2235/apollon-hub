export type LunaSearchMode = "docs" | "images" | "files";
export function normalizeSearchMode(value: unknown): LunaSearchMode {
  return value === "images" || value === "files" ? value : "docs";
}
