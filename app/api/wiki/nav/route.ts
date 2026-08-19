import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser } from "@/lib/wiki/api";
import { countDocsByMenu, loadWikiMenus } from "@/lib/wiki/menus";
import { loadWikiTermCount } from "@/lib/wiki/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  try {
    const [terms, menus, counts] = await Promise.all([
      loadWikiTermCount(gate.admin),
      loadWikiMenus(gate.admin, { includeHidden: gate.isAdmin }),
      countDocsByMenu(gate.admin, { isSuperAdmin: gate.isAdmin })
    ]);
    const withCounts = menus
      .filter((m) => m.is_active || gate.isAdmin)
      .map((m) => ({ ...m, doc_count: counts.get(m.slug) ?? 0 }));
    return NextResponse.json({
      terms,
      menus: withCounts,
      is_admin: gate.isAdmin,
      wiki_ready: true
    });
  } catch (err) {
    console.error("[wiki/nav]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}
