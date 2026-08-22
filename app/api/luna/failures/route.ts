import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  clusterFailures,
  completeFailureDbFixes,
  completeFailureDevPrompt,
  groupDevPrompts,
  listLunaFailures,
  markFailureImprovedIfDone,
  matchesKindFilter,
  saveFailureImprovementDraft,
  setFailureVerdict,
  summarizeFailureKinds,
  type FailureKindFilter
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
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: FailureKindFilter =
    kindParam === "human" ||
    kindParam === "self" ||
    kindParam === "auto" ||
    kindParam === "inspect"
      ? kindParam
      : "all";

  const allRows = await listLunaFailures(admin, {
    verdict:
      verdict === "open" || verdict === "improve" || verdict === "skip"
        ? verdict
        : undefined
  });
  const kind_summary = summarizeFailureKinds(allRows);
  const rows = allRows.filter((r) => matchesKindFilter(r, kind));
  const open = rows.filter((r) => !r.verdict);
  const improved = rows.filter((r) => r.verdict === "improve");
  const skipped = rows.filter((r) => r.verdict === "skip");
  const clusters = clusterFailures(open).map(
    ({ items: _items, ...rest }) => rest
  );

  return NextResponse.json({
    summary: {
      open: open.length,
      improve: improved.length,
      skip: skipped.length
    },
    kind_summary,
    clusters,
    dev_groups: groupDevPrompts(improved),
    items: rows
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
    action?: "improve_send" | "db_complete" | "dev_complete" | "dev_fixed" | "skip";
    note?: string;
    selected_ids?: string[];
  };
  const id = body.id?.trim();
  const action = body.action;
  if (
    !id ||
    (action !== "improve_send" &&
      action !== "db_complete" &&
      action !== "dev_complete" &&
      action !== "dev_fixed" &&
      action !== "skip")
  ) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }

  if (action === "skip") {
    const result = await setFailureVerdict(admin, id, "skip");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const rows = await listLunaFailures(admin);
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "improve_send") {
    const note = body.note?.trim() ?? "";
    if (!note) {
      return NextResponse.json({ error: "note required for improve_send" }, { status: 400 });
    }
    const data = await saveFailureImprovementDraft(admin, row, note);
    return NextResponse.json(data);
  }

  if (action === "db_complete") {
    const selectedIds = Array.isArray(body.selected_ids)
      ? body.selected_ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
    const result = await completeFailureDbFixes(admin, row, user.id, selectedIds);
    await markFailureImprovedIfDone(admin, id);
    return NextResponse.json({ ok: true, created: result.created });
  }

  if (action === "dev_complete") {
    await completeFailureDevPrompt(admin, id);
    await markFailureImprovedIfDone(admin, id);
    return NextResponse.json({ ok: true });
  }

  if (action === "dev_fixed") {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("luna_failures")
      .update({ dev_fixed_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
