import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { listLunaFailures, loadFailureThread } from "@/lib/luna/failures";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const rows = await listLunaFailures(admin);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const thread = await loadFailureThread(admin, row);
    return NextResponse.json({
      item: row,
      thread
    });
  } catch (err) {
    console.error("[luna/failures/thread]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Thread failed" },
      { status: 500 }
    );
  }
}
