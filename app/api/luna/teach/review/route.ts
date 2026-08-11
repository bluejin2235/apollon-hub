import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { error: "id and action ('approve'|'reject') required" },
      { status: 400 }
    );
  }

  const { data: row, error: fetchError } = await admin
    .from("luna_learnings")
    .select(
      "id, status, origin, review_reason, merge_target, raw_input, content"
    )
    .eq("id", id)
    .eq("status", "candidate")
    .maybeSingle();

  if (fetchError) {
    console.error("[luna/teach/review] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
  }

  const origin = row.origin as string | null;
  const reviewReason =
    typeof row.review_reason === "string" ? row.review_reason : null;
  if (origin !== "direct" && !reviewReason) {
    return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // 정리(consolidation) 후보: 반려 = active 원복
  if (reviewReason && action === "reject") {
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "active",
        review_reason: null,
        merge_target: null,
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error("[luna/teach/review] reject restore", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: data.id, status: data.status });
  }

  // duplicate 승인: 본문 content ← candidate.raw_input, candidate → archived
  if (reviewReason === "duplicate" && action === "approve") {
    const mergeTarget =
      typeof row.merge_target === "string" ? row.merge_target.trim() : "";
    const merged =
      typeof row.raw_input === "string" ? row.raw_input.trim() : "";
    if (!mergeTarget || !merged) {
      return NextResponse.json(
        { error: "duplicate candidate missing merge_target or raw_input" },
        { status: 400 }
      );
    }

    const { error: keepError } = await admin
      .from("luna_learnings")
      .update({
        content: merged,
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", mergeTarget)
      .eq("status", "active");

    if (keepError) {
      console.error("[luna/teach/review] duplicate keep", keepError);
      return NextResponse.json({ error: keepError.message }, { status: 500 });
    }

    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error("[luna/teach/review] duplicate archive", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: data.id, status: data.status });
  }

  // stale 승인: 폐기 확정 → archived
  if (reviewReason === "stale" && action === "approve") {
    const { data, error } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .eq("id", id)
      .eq("status", "candidate")
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error("[luna/teach/review] stale archive", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: data.id, status: data.status });
  }

  // 일반 직접학습 후보
  const nextStatus = action === "approve" ? "active" : "archived";
  const { data, error } = await admin
    .from("luna_learnings")
    .update({
      status: nextStatus,
      resolved_by: user.id,
      resolved_at: nowIso
    })
    .eq("id", id)
    .eq("status", "candidate")
    .eq("origin", "direct")
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[luna/teach/review]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
