/**
 * 같은 from-to 질문 중복 삭제 (pending 외 status 포함)
 * npx tsx scripts/delete-duplicate-same-questions.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { notionBreadcrumb, notionPathScore, questionDedupeKey } from "@/lib/luna-admin/pair-view";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseCtx(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

async function main() {
  const admin = adminClient();
  const { data, error } = await admin
    .from("luna_questions")
    .select("id, context, created_at, status")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const ctx = parseCtx(row.context);
    const key = questionDedupeKey({
      from_id: String(ctx.from_id ?? ""),
      to_id: String(ctx.to_id ?? ""),
      to_type: String(ctx.to_type ?? ""),
      to_title: String(ctx.to_title ?? "")
    });
    if (!key.replace(/\t/g, "")) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const notionIds = [
    ...new Set(
      rows
        .map((row) => {
          const ctx = parseCtx(row.context);
          return String(ctx.to_type) === "notion_page" ? String(ctx.to_id ?? "") : "";
        })
        .filter(Boolean)
    )
  ];
  const pathByPage = new Map<string, string>();
  for (let i = 0; i < notionIds.length; i += 100) {
    const batch = notionIds.slice(i, i + 100);
    const { data: pages } = await admin
      .from("luna_notion_pages")
      .select("page_id, path_titles")
      .in("page_id", batch);
    for (const page of pages ?? []) {
      pathByPage.set(
        String(page.page_id),
        notionBreadcrumb((page.path_titles as string[] | null) ?? null)
      );
    }
  }

  const deleteIds: string[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const scored = list.map((row) => {
      const ctx = parseCtx(row.context);
      const pageId = String(ctx.to_id ?? "");
      const path =
        String(ctx.to_path ?? "") || pathByPage.get(pageId) || String(ctx.from_path ?? "");
      const preferKeep =
        row.status === "answered" ? 1000 : row.status === "pending" ? 100 : 0;
      return { row, score: notionPathScore(path) + preferKeep };
    });
    scored.sort((a, b) => b.score - a.score);
    for (const extra of scored.slice(1)) deleteIds.push(extra.row.id);
  }

  for (let i = 0; i < deleteIds.length; i += 50) {
    const { error: delErr } = await admin
      .from("luna_questions")
      .delete()
      .in("id", deleteIds.slice(i, i + 50));
    if (delErr) throw new Error(delErr.message);
  }

  console.log(
    JSON.stringify(
      {
        groups_with_dupes: [...groups.values()].filter((g) => g.length > 1).length,
        deleted: deleteIds.length
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
