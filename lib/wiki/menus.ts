import type { SupabaseClient } from "@supabase/supabase-js";
import type { WikiMenu, WikiMenuEditableBy } from "@/lib/wiki/types";
import { inferWikiMenuSlug, WIKI_SEED_MENUS } from "@/lib/wiki/types";

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg = "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("column")
  );
}

function asText(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function mapMenu(row: Record<string, unknown>, docCount?: number): WikiMenu {
  const editable =
    row.editable_by === "admin" ? "admin" : ("all" as WikiMenuEditableBy);
  return {
    slug: asText(row.slug),
    name: asText(row.name, asText(row.slug)),
    description: asText(row.description),
    editable_by: editable,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
    is_active: row.is_active !== false,
    doc_count: docCount
  };
}

export async function loadWikiMenus(
  admin: SupabaseClient,
  opts?: { includeHidden?: boolean }
): Promise<WikiMenu[]> {
  let q = admin
    .from("luna_wiki_menus")
    .select("slug, name, description, editable_by, sort_order, is_active")
    .order("sort_order", { ascending: true });
  if (!opts?.includeHidden) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return [...WIKI_SEED_MENUS];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => mapMenu(r));
}

export async function loadWikiMenu(
  admin: SupabaseClient,
  slug: string
): Promise<WikiMenu | null> {
  const { data, error } = await admin
    .from("luna_wiki_menus")
    .select("slug, name, description, editable_by, sort_order, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      return WIKI_SEED_MENUS.find((m) => m.slug === slug) ?? null;
    }
    throw new Error(error.message);
  }
  return data ? mapMenu(data as Record<string, unknown>) : null;
}

export async function saveWikiMenu(
  admin: SupabaseClient,
  input: {
    slug: string;
    name: string;
    description?: string;
    editable_by?: WikiMenuEditableBy;
    sort_order?: number;
    is_active?: boolean;
  }
): Promise<WikiMenu> {
  const row = {
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    editable_by: input.editable_by ?? "all",
    sort_order: input.sort_order ?? 100,
    is_active: input.is_active !== false
  };
  const { data, error } = await admin
    .from("luna_wiki_menus")
    .upsert(row, { onConflict: "slug" })
    .select("slug, name, description, editable_by, sort_order, is_active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("메뉴를 저장하지 못했습니다.");
  return mapMenu(data as Record<string, unknown>);
}

export async function reorderWikiMenus(
  admin: SupabaseClient,
  slugs: string[]
): Promise<void> {
  await Promise.all(
    slugs.map(async (slug, i) => {
      const { error } = await admin
        .from("luna_wiki_menus")
        .update({ sort_order: (i + 1) * 10 })
        .eq("slug", slug);
      if (error) throw new Error(error.message);
    })
  );
}

export async function countDocsByMenu(
  admin: SupabaseClient,
  opts?: { isSuperAdmin?: boolean }
): Promise<Map<string, number>> {
  const first = await admin
    .from("luna_library")
    .select("menu_slug, visible_to_staff, is_active, title, kind")
    .eq("is_active", true);
  let data: Record<string, unknown>[] | null =
    (first.data as Record<string, unknown>[] | null) ?? null;
  let error = first.error;
  if (error && isMissingTable(error)) {
    const retry = await admin
      .from("luna_library")
      .select("category, visible_to_staff, is_active, title, kind")
      .eq("is_active", true);
    data = (retry.data as Record<string, unknown>[] | null) ?? null;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const slug = inferWikiMenuSlug(
      typeof row.title === "string" ? row.title : "",
      typeof row.menu_slug === "string"
        ? row.menu_slug
        : typeof row.category === "string"
          ? row.category
          : "",
      typeof row.kind === "string" ? row.kind : ""
    );
    if (!slug) continue;
    if (!opts?.isSuperAdmin && row.visible_to_staff === false) continue;
    map.set(slug, (map.get(slug) ?? 0) + 1);
  }
  return map;
}
