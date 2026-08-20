import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  applyFailureImprovement,
  clusterFailures,
  listLunaFailures,
  setFailureVerdict
} from "@/lib/luna/failures";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const verdict = request.nextUrl.searchParams.get("verdict");
  const rows = await listLunaFailures(admin, {
    verdict:
      verdict === "open" || verdict === "improve" || verdict === "skip"
        ? verdict
        : undefined
  });
  const open = rows.filter((r) => !r.verdict);
  const improved = rows.filter((r) => r.verdict === "improve");
  const skipped = rows.filter((r) => r.verdict === "skip");
  const clusters = clusterFailures(open);

  return NextResponse.json({
    summary: {
      open: open.length,
      improve: improved.length,
      skip: skipped.length
    },
    clusters,
    items: open
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    id?: string;
    action?: "improve" | "skip";
    note?: string;
  };
  const id = body.id?.trim();
  const action = body.action;
  if (!id || (action !== "improve" && action !== "skip")) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }

  if (action === "skip") {
    const result = await setFailureVerdict(admin, id, "skip");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const note = body.note?.trim() ?? "";
  if (!note) {
    return NextResponse.json({ error: "note required for improve" }, { status: 400 });
  }

  const rows = await listLunaFailures(admin);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const routed = await applyFailureImprovement(admin, row, note, user.id);
  const result = await setFailureVerdict(admin, id, "improve", note);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, improve_target: routed.target });
}
