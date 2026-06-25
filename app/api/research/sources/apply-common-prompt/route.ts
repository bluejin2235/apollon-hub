import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  DEFAULT_GPT_CURATOR_PROMPT,
  GPT_CURATOR_PROMPT_KEY
} from "@/lib/research/gpt-curator-prompt";

export const runtime = "nodejs";

const SUPER_ADMIN_ROLE = "슈퍼관리자";

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

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (profile?.role !== SUPER_ADMIN_ROLE) {
      return NextResponse.json({ error: "슈퍼관리자만 사용할 수 있습니다." }, { status: 403 });
    }

    const { data: setting, error: settingError } = await admin
      .from("trend_settings")
      .select("value")
      .eq("key", GPT_CURATOR_PROMPT_KEY)
      .maybeSingle();

    if (settingError) {
      return NextResponse.json({ error: settingError.message }, { status: 500 });
    }

    const prompt = setting?.value?.trim() || DEFAULT_GPT_CURATOR_PROMPT;

    const { data: updatedRows, error: updateError } = await admin
      .from("trend_sources")
      .update({ gpt_prompt: prompt })
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedRows?.length ?? 0
    });
  } catch (error) {
    console.error("[research/sources/apply-common-prompt]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
