import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { recordMergeRun } from "@/lib/luna/knowledge-merge-gate";
import { runKnowledgeMerge } from "@/lib/luna/knowledge-merge";

export const runtime = "nodejs";

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!isCronAuthorized(request)) {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isSuperAdminUser(admin, user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const { count } = await admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "candidate")
      .neq("category", "identity");

    const result = await runKnowledgeMerge(admin);
    await recordMergeRun(admin, {
      count: count ?? 0,
      trigger: "manual"
    });
    return NextResponse.json({ skipped: false, trigger: "manual", ...result });
  } catch (err) {
    console.error("[luna/knowledge/merge]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
