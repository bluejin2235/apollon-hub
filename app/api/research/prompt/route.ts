import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  LUNA_SYSTEM_PROMPT_KEY,
  resolveLunaSystemPrompt
} from "@/lib/research/luna-system-prompt";

export const runtime = "nodejs";

type SavePromptBody = {
  value?: string;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const prompt = await resolveLunaSystemPrompt(admin);
    const { data: row } = await admin
      .from("trend_settings")
      .select("value")
      .eq("key", LUNA_SYSTEM_PROMPT_KEY)
      .maybeSingle();

    return NextResponse.json({
      key: LUNA_SYSTEM_PROMPT_KEY,
      value: prompt,
      is_default: !row?.value?.trim()
    });
  } catch (error) {
    console.error("[research/prompt] GET", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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

    let body: SavePromptBody;
    try {
      body = (await request.json()) as SavePromptBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const value = body.value?.trim();
    if (!value) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    const { error: saveError } = await admin.from("trend_settings").upsert(
      {
        key: LUNA_SYSTEM_PROMPT_KEY,
        value,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, key: LUNA_SYSTEM_PROMPT_KEY });
  } catch (error) {
    console.error("[research/prompt] POST", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
