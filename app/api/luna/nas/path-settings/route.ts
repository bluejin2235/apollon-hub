import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  DEFAULT_NAS_PATH_SETTINGS,
  normalizePrefixInput,
  parseNasPathSettingsRow,
  serializeNasPathSettings,
  type NasPathDisplayMode,
  type NasPathSettings
} from "@/lib/luna/nas-path-settings";

export const runtime = "nodejs";

function parseMode(value: unknown): NasPathDisplayMode | null {
  if (value === "office" || value === "custom" || value === "unc") return value;
  return null;
}

function validateCustomPrefixes(settings: NasPathSettings): string | null {
  if (settings.mode !== "custom") return null;
  if (!normalizePrefixInput(settings.prefixT)) {
    return "custom mode requires T prefix";
  }
  if (!normalizePrefixInput(settings.prefixP)) {
    return "custom mode requires P prefix";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("luna_nas_path_settings")
    .select("display_mode, prefix_t, prefix_p, updated_at")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[luna/nas/path-settings] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings = data ? parseNasPathSettingsRow(data) : { ...DEFAULT_NAS_PATH_SETTINGS };

  return NextResponse.json({
    settings,
    updated_at: data?.updated_at ?? null
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

  let body: {
    mode?: unknown;
    display_mode?: unknown;
    prefix_t?: unknown;
    prefix_p?: unknown;
    prefixT?: unknown;
    prefixP?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = parseMode(body.mode ?? body.display_mode);
  if (!mode) {
    return NextResponse.json({ error: "mode must be office, custom, or unc" }, { status: 400 });
  }

  const settings: NasPathSettings = {
    mode,
    prefixT:
      typeof body.prefix_t === "string"
        ? body.prefix_t
        : typeof body.prefixT === "string"
          ? body.prefixT
          : "",
    prefixP:
      typeof body.prefix_p === "string"
        ? body.prefix_p
        : typeof body.prefixP === "string"
          ? body.prefixP
          : ""
  };

  const customErr = validateCustomPrefixes(settings);
  if (customErr) {
    return NextResponse.json({ error: customErr }, { status: 400 });
  }

  const payload = {
    profile_id: user.id,
    ...serializeNasPathSettings(settings),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from("luna_nas_path_settings")
    .upsert(payload, { onConflict: "profile_id" })
    .select("display_mode, prefix_t, prefix_p, updated_at")
    .single();

  if (error) {
    console.error("[luna/nas/path-settings] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: parseNasPathSettingsRow(data),
    updated_at: data.updated_at
  });
}
