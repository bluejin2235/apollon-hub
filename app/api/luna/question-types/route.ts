import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  parseWebAugmentEnabled,
  WEB_AUGMENT_SETTINGS_KEY
} from "@/lib/luna/knowledge-match";
import {
  loadQuestionTypes,
  type QuestionTypeRow
} from "@/lib/luna/question-types";

export const runtime = "nodejs";

const SLUG_RE = /^[a-z][a-z0-9_]{1,32}$/;

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

function parseTypeBody(
  body: Record<string, unknown>,
  slugRequired: boolean
): { error: string } | { row: Partial<QuestionTypeRow> & { slug?: string } } {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (slugRequired && !SLUG_RE.test(slug)) {
    return { error: "slug 는 영문 소문자로 시작하고 영문·숫자·_ 만 씁니다." };
  }
  const row: Partial<QuestionTypeRow> & { slug?: string } = {};
  if (slug) row.slug = slug;
  if (typeof body.label === "string") row.label = body.label.trim();
  if (typeof body.criteria === "string") row.criteria = body.criteria;
  if (typeof body.sources === "string") row.sources = body.sources;
  if (typeof body.answer_form === "string") row.answer_form = body.answer_form;
  if (body.prompt_key === null) row.prompt_key = null;
  if (typeof body.prompt_key === "string") {
    row.prompt_key = body.prompt_key.trim() || null;
  }
  if (typeof body.needs_search === "boolean") row.needs_search = body.needs_search;
  if (typeof body.needs_library === "boolean") row.needs_library = body.needs_library;
  if (typeof body.skip_clarify === "boolean") row.skip_clarify = body.skip_clarify;
  if (typeof body.is_active === "boolean") row.is_active = body.is_active;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    row.sort_order = Math.round(body.sort_order);
  }
  return { row };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  const activeOnly = request.nextUrl.searchParams.get("active") === "true";
  try {
    const { types, source } = await loadQuestionTypes(admin, {
      activeOnly
    });
    const { data: webRow } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", WEB_AUGMENT_SETTINGS_KEY)
      .maybeSingle();
    return NextResponse.json({
      types,
      source,
      web_augment: parseWebAugmentEnabled(webRow?.value)
    });
  } catch (err) {
    console.error("[luna/question-types] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseTypeBody(body, true);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = parsed.row;
  if (!row.slug || !row.label) {
    return NextResponse.json({ error: "slug 와 label 이 필요합니다." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_question_types")
    .insert({
      slug: row.slug,
      label: row.label,
      criteria: row.criteria ?? "",
      sources: row.sources ?? "",
      answer_form: row.answer_form ?? "",
      prompt_key: row.prompt_key ?? null,
      needs_search: row.needs_search ?? false,
      needs_library: row.needs_library ?? false,
      skip_clarify: row.skip_clarify ?? false,
      is_active: row.is_active ?? true,
      sort_order: row.sort_order ?? 99
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[luna/question-types] POST", error);
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return NextResponse.json(
      {
        error: missing
          ? "luna_question_types 테이블이 없습니다. 마이그레이션을 실행하세요."
          : error.message
      },
      { status: missing ? 503 : 500 }
    );
  }
  return NextResponse.json({ type: data });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const parsed = parseTypeBody(body, false);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const patch = { ...parsed.row };
  delete patch.slug;
  const update = {
    ...patch,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from("luna_question_types")
    .update(update)
    .eq("slug", slug)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[luna/question-types] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let webAugment: boolean | undefined;
  if (slug === "know" && typeof body.web_augment === "boolean") {
    const { error: settingsError } = await admin.from("luna_settings").upsert(
      {
        key: WEB_AUGMENT_SETTINGS_KEY,
        value: { enabled: body.web_augment },
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );
    if (settingsError) {
      console.error("[luna/question-types] web_augment", settingsError);
      return NextResponse.json(
        { error: settingsError.message },
        { status: 500 }
      );
    }
    webAugment = body.web_augment;
  }

  return NextResponse.json({
    type: data,
    ...(webAugment !== undefined ? { web_augment: webAugment } : {})
  });
}
