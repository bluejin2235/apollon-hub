import { supabase } from "@/lib/supabase/client";

/** alias → canonical */
export async function fetchApiKeyAliasLookup(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("api_key_aliases").select("alias, canonical");

  if (error) {
    console.error("[api_key_aliases] fetch failed", error);
    return {};
  }

  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    const alias = typeof row.alias === "string" ? row.alias.trim() : "";
    const canonical = typeof row.canonical === "string" ? row.canonical.trim() : "";
    if (alias && canonical) out[alias] = canonical;
  }
  return out;
}

export function applyApiKeyAlias(label: string, lookup: Record<string, string>): string {
  const raw = label.trim();
  if (!raw) return raw;
  return lookup[raw] ?? raw;
}
