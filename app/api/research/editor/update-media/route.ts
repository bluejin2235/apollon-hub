import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

type UpdateMediaBody = {
  candidateId?: string;
  selected_image_url?: string | null;
  editor_uploaded_images?: string[] | null;
  hidden_images?: string[] | null;
  video_urls?: string[] | null;
  editor_insight?: string | null;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const canManage = await isResearchManagerServer(admin, user.id);
    if (!canManage) {
      return NextResponse.json({ error: "트렌드 레이더 관리 권한이 없습니다." }, { status: 403 });
    }

    let body: UpdateMediaBody;
    try {
      body = (await request.json()) as UpdateMediaBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const candidateId = body.candidateId?.trim();
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if ("selected_image_url" in body) {
      if (body.selected_image_url !== null && typeof body.selected_image_url !== "string") {
        return NextResponse.json({ error: "selected_image_url must be a string or null" }, { status: 400 });
      }
      updates.selected_image_url = body.selected_image_url;
    }

    if ("editor_uploaded_images" in body) {
      if (body.editor_uploaded_images !== null && !isStringArray(body.editor_uploaded_images)) {
        return NextResponse.json({ error: "editor_uploaded_images must be a string array or null" }, { status: 400 });
      }
      updates.editor_uploaded_images = body.editor_uploaded_images;
    }

    if ("hidden_images" in body) {
      if (body.hidden_images !== null && !isStringArray(body.hidden_images)) {
        return NextResponse.json({ error: "hidden_images must be a string array or null" }, { status: 400 });
      }
      updates.hidden_images = body.hidden_images;
    }

    if ("video_urls" in body) {
      if (body.video_urls !== null && !isStringArray(body.video_urls)) {
        return NextResponse.json({ error: "video_urls must be a string array or null" }, { status: 400 });
      }
      updates.video_urls = body.video_urls;
    }

    if ("editor_insight" in body) {
      if (body.editor_insight !== null && typeof body.editor_insight !== "string") {
        return NextResponse.json({ error: "editor_insight must be a string or null" }, { status: 400 });
      }
      updates.editor_insight = body.editor_insight;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error: updateError } = await admin
      .from("trend_editor_candidates")
      .update(updates)
      .eq("id", candidateId);

    if (updateError) {
      console.error("[research/editor/update-media] update failed", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[research/editor/update-media]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
