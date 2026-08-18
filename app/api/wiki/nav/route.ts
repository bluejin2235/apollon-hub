import { NextRequest, NextResponse } from "next/server";
import { requireWikiUser } from "@/lib/wiki/api";
import { loadWikiNavCounts } from "@/lib/wiki/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = await requireWikiUser(request);
  if ("error" in gate) return gate.error;
  try {
    const counts = await loadWikiNavCounts(gate.admin, {
      isSuperAdmin: gate.isAdmin
    });
    return NextResponse.json({
      ...counts,
      is_admin: gate.isAdmin
    });
  } catch (err) {
    console.error("[wiki/nav]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}
