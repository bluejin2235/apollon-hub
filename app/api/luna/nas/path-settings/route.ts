import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  DEFAULT_NAS_PATH_SETTINGS,
  normalizePrefixInput,
  parseNasPathSettingsRow,
  serializeNasPathSettings,
  type ModalPathTab,
  type NasPathDisplayMode,
  type NasPathSettings
} from "@/lib/luna/nas-path-settings";

export const runtime = "nodejs";

function parseMode(value: unknown): NasPathDisplayMode | null {
  if (value === "office" || value === "custom" || value === "unc") return value;
  return null;
}

function parseModalPathTab(value: unknown): ModalPathTab | null {
  return parseMode(value);
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

const SELECT_COLS =
  "display_mode, prefix_t, prefix_p, modal_path_tab, updated_at";

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
    .select(SELECT_COLS)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[luna/nas/path-settings] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings = data
    ? parseNasPathSettingsRow(data)
    : { ...DEFAULT_NAS_PATH_SETTINGS };

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
    modal_path_tab?: unknown;
    modalPathTab?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const modalOnly =
    body.modal_path_tab !== undefined || body.modalPathTab !== undefined;
  const mode = parseMode(body.mode ?? body.display_mode);

  if (!modalOnly && !mode) {
    return NextResponse.json(
      { error: "mode must be office, custom, or unc" },
      { status: 400 }
    );
  }

  const { data: existing } = await admin
    .from("luna_nas_path_settings")
    .select(SELECT_COLS)
    .eq("profile_id", user.id)
    .maybeSingle();

  const base = existing
    ? parseNasPathSettingsRow(existing)
    : { ...DEFAULT_NAS_PATH_SETTINGS };

  const settings: NasPathSettings = {
    mode: mode ?? base.mode,
    prefixT:
      typeof body.prefix_t === "string"
        ? body.prefix_t
        : typeof body.prefixT === "string"
          ? body.prefixT
          : base.prefixT,
    prefixP:
      typeof body.prefix_p === "string"
        ? body.prefix_p
        : typeof body.prefixP === "string"
          ? body.prefixP
          : base.prefixP,
    modalPathTab:
      body.modal_path_tab !== undefined || body.modalPathTab !== undefined
        ? parseModalPathTab(body.modal_path_tab ?? body.modalPathTab)
        : base.modalPathTab ?? null
  };

  if (!modalOnly) {
    const customErr = validateCustomPrefixes(settings);
    if (customErr) {
      return NextResponse.json({ error: customErr }, { status: 400 });
    }
  }

  const payload = {
    profile_id: user.id,
    ...serializeNasPathSettings(settings),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from("luna_nas_path_settings")
    .upsert(payload, { onConflict: "profile_id" })
    .select(SELECT_COLS)
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
