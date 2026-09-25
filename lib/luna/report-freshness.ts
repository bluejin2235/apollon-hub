import type { SupabaseClient } from "@supabase/supabase-js";

type SourceVersion =
  | { type: "notion"; page_id: string; last_edited_time: string }
  | { type: "nas"; ref: string; drive: string; modified_at: string; size_bytes: number };
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Legacy URL-only references cannot establish freshness. Never silently call them current. */
export async function reportSourcesAreCurrent(admin: SupabaseClient, sources: unknown): Promise<boolean> {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 32) return false;
  const versions: SourceVersion[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") return false;
    if (source.type === "notion" && typeof source.page_id === "string" &&
      /^[a-f0-9-]{32,36}$/i.test(source.page_id) && instant(source.last_edited_time) !== null) {
      versions.push(source as SourceVersion);
    } else if (source.type === "nas" && typeof source.ref === "string" && source.ref.length > 0 &&
      typeof source.drive === "string" && /^[A-Z]$/.test(source.drive) &&
      instant(source.modified_at) !== null && Number.isSafeInteger(source.size_bytes) && source.size_bytes >= 0) {
      versions.push(source as SourceVersion);
    } else return false; // Includes unversioned web references and legacy reports.
  }
  const notion = versions.filter((s): s is Extract<SourceVersion, {type:"notion"}> => s.type === "notion");
  if (notion.length) {
    const result = await admin.from("luna_notion_pages").select("page_id, last_edited_time, archived")
      .in("page_id", notion.map(s => s.page_id)).eq("archived", false);
    if (result.error) return false;
    const pages = new Map((result.data ?? []).map(row => [row.page_id, row]));
    for (const source of notion) {
      const page = pages.get(source.page_id);
      if (!page || instant(page.last_edited_time) !== instant(source.last_edited_time)) return false;
    }
  }
  const nas = versions.filter((s): s is Extract<SourceVersion, {type:"nas"}> => s.type === "nas");
  if (nas.length) {
    const result = await admin.from("nas_directory").select("drive, path, modified_at, size_bytes")
      .in("path", nas.map(s => s.ref)).eq("type", "file").order("scan_batch", {ascending:false}).limit(1000);
    if (result.error) return false;
    for (const source of nas) {
      const file = (result.data ?? []).find(row => row.drive === source.drive && row.path === source.ref);
      if (!file || instant(file.modified_at) !== instant(source.modified_at) || Number(file.size_bytes) !== source.size_bytes) return false;
    }
  }
  return true;
}
