import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

const RESULTS = new Set(["confirmed", "refuted", "inconclusive"]);

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

  let body: {
    version_id?: string;
    verify_result?: string;
    verify_note?: string;
    run_id?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const versionId =
    typeof body.version_id === "string" ? body.version_id.trim() : "";
  const verifyResult =
    typeof body.verify_result === "string" ? body.verify_result.trim() : "";
  const runId = typeof body.run_id === "string" ? body.run_id.trim() : "";
  const verifyNote =
    typeof body.verify_note === "string" ? body.verify_note.trim() : "";

  if (!versionId || !RESULTS.has(verifyResult) || !runId) {
    return NextResponse.json(
      { error: "version_id, verify_result, and run_id are required" },
      { status: 400 }
    );
  }

  const { data: version, error: loadError } = await admin
    .from("luna_prompt_versions")
    .select("id, prediction")
    .eq("id", versionId)
    .maybeSingle();

  if (loadError) {
    console.error("[luna/prompts/verify] load", loadError);
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!version.prediction) {
    return NextResponse.json(
      { error: "Only versions with prediction can be verified" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("luna_prompt_versions")
    .update({
      verify_run_id: runId,
      verify_result: verifyResult,
      verify_note: verifyNote || null,
      verified_at: new Date().toISOString()
    })
    .eq("id", versionId)
    .select(
      "id, version, prediction, verify_run_id, verify_result, verify_note, verified_at"
    )
    .maybeSingle();

  if (error) {
    console.error("[luna/prompts/verify] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ version: data });
}
