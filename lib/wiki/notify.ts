import type { SupabaseClient } from "@supabase/supabase-js";
import { wikiDocPath } from "@/lib/wiki/types";

export async function notifyWikiRuleChange(
  admin: SupabaseClient,
  opts: {
    slug: string;
    title: string;
    editorName: string;
  }
): Promise<void> {
  const { error } = await admin.from("hub_notifications").insert({
    category: "wiki_rules",
    title: `규정이 바뀌었어요: ${opts.title}`,
    body: `${opts.editorName}이 「${opts.title}」을 고쳤습니다.`,
    link: wikiDocPath(opts.slug),
    level: "info",
    scope: "all",
    meta: { slug: opts.slug, menu_slug: "rules" }
  });
  if (error) {
    console.error("[wiki] rule notify", error);
  }
}

type WikiChangeBit = { title: string; name: string };

export async function collectWikiMorningLine(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string | null> {
  const bits: WikiChangeBit[] = [];

  {
    let gq = await admin
      .from("glossary_terms")
      .select("term_ko, updated_at, updated_by")
      .is("deleted_at", null)
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (gq.error) {
      gq = await admin
        .from("glossary_terms")
        .select("term_ko, updated_at, updated_by")
        .gte("updated_at", startIso)
        .lt("updated_at", endIso)
        .order("updated_at", { ascending: false })
        .limit(20);
    }
    if (!gq.error) {
      const ids = [
        ...new Set(
          (gq.data ?? [])
            .map((r) => r.updated_by)
            .filter((id): id is string => typeof id === "string")
        )
      ];
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profs } = await admin
          .from("profiles")
          .select("id, name")
          .in("id", ids);
        for (const p of profs ?? []) {
          names.set(String(p.id), String(p.name ?? ""));
        }
      }
      for (const row of gq.data ?? []) {
        const title = typeof row.term_ko === "string" ? row.term_ko.trim() : "";
        if (!title) continue;
        const name =
          (typeof row.updated_by === "string"
            ? names.get(row.updated_by)
            : "") || "알 수 없음";
        bits.push({ title, name });
      }
    }
  }

  {
    const lib = await admin
      .from("luna_library")
      .select("slug, title, menu_slug, updated_at, updated_by_name")
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (lib.error) {
      if (
        lib.error.code !== "PGRST204" &&
        !String(lib.error.message ?? "").includes("category")
      ) {
        console.error("[wiki] morning library", lib.error);
      }
    } else {
      for (const row of lib.data ?? []) {
        const title = typeof row.title === "string" ? row.title.trim() : "";
        const slug = typeof row.slug === "string" ? row.slug : "";
        if (!title || !slug) continue;
        bits.push({
          title,
          name:
            typeof row.updated_by_name === "string" && row.updated_by_name.trim()
              ? row.updated_by_name.trim()
              : "알 수 없음"
        });
      }
    }
  }

  if (bits.length === 0) return null;
  const shown = bits.slice(0, 8);
  const names = shown.map((b) => `${b.title}(${b.name})`).join(" · ");
  return `어제 위키가 ${bits.length}건 바뀌었어요: ${names}`;
}

export async function notifyPrivateWikiOveruse(
  admin: SupabaseClient,
  opts: {
    conversationId: string;
    userName: string;
    slug: string;
    docTitle: string;
    count: number;
  }
): Promise<void> {
  const { error } = await admin.from("hub_notifications").insert({
    category: "wiki_private_overuse",
    title: `내부 문서 과다 인용: ${opts.docTitle}`,
    body: `${opts.userName}님의 대화에서 「${opts.docTitle}」 내부 기준이 ${opts.count}회 인용되었습니다.`,
    link: `/luna?c=${opts.conversationId}`,
    level: "warn",
    scope: "admin",
    meta: {
      slug: opts.slug,
      conversation_id: opts.conversationId,
      count: opts.count
    }
  });
  if (error) {
    console.error("[wiki] private overuse notify", error);
  }
}
