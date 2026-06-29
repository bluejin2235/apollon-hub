import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  isResearchPromptKey,
  resolvePromptStorageKey,
  resolveResearchPrompts,
  type ResearchPromptKey
} from "@/lib/research/prompt-settings";

export const runtime = "nodejs";

type SavePromptBody = {
  key?: string;
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

    const prompts = await resolveResearchPrompts(admin);
    return NextResponse.json({ prompts });
  } catch (error) {
    console.error("[research/prompts] GET", error);
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

    const key = body.key?.trim();
    const value = body.value?.trim();

    if (!key || !isResearchPromptKey(key)) {
      return NextResponse.json({ error: "유효하지 않은 key입니다." }, { status: 400 });
    }

    if (!value) {
      return NextResponse.json({ error: "value is required" }, { status: 400 });
    }

    const storageKey = resolvePromptStorageKey(key as ResearchPromptKey);
    const { error: saveError } = await admin.from("trend_settings").upsert(
      {
        key: storageKey,
        value,
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, key });
  } catch (error) {
    console.error("[research/prompts] POST", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
