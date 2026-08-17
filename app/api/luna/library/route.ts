import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  isLibraryKind,
  loadLibraryAdmin,
  type LibraryAdminRow
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

function parseLibraryBody(
  body: Record<string, unknown>,
  slugRequired: boolean
): { error: string } | { row: Partial<LibraryAdminRow> & { slug?: string } } {
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (slugRequired && !SLUG_RE.test(slug)) {
    return { error: "slug 는 영문 소문자로 시작하고 영문·숫자·_ 만 씁니다." };
  }
  const row: Partial<LibraryAdminRow> & { slug?: string } = {};
  if (slug) row.slug = slug;
  if (typeof body.title === "string") row.title = body.title.trim();
  if (typeof body.kind === "string") {
    const kind = body.kind.trim();
    if (!isLibraryKind(kind)) {
      return { error: "kind 는 문서양식·분석기준·톤가이드 중 하나입니다." };
    }
    row.kind = kind;
  }
  if (typeof body.content === "string") row.content = body.content;
  if (typeof body.is_active === "boolean") row.is_active = body.is_active;
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
    const { items, tableReady } = await loadLibraryAdmin(admin, { activeOnly });
    if (!tableReady) {
      return NextResponse.json(
        {
          error: "luna_library 테이블이 없습니다. 마이그레이션을 실행하세요.",
          items: [],
          table_ready: false
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ items, table_ready: true });
  } catch (err) {
    console.error("[luna/library] GET", err);
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

  const parsed = parseLibraryBody(body, true);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = parsed.row;
  if (!row.slug || !row.title) {
    return NextResponse.json({ error: "slug 와 title 이 필요합니다." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_library")
    .insert({
      slug: row.slug,
      title: row.title,
      kind: row.kind ?? "template",
      content: row.content ?? "",
      is_active: row.is_active ?? true
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[luna/library] POST", error);
    const missing = error.code === "42P01" || error.code === "PGRST205";
    const duplicate = error.code === "23505";
    return NextResponse.json(
      {
        error: missing
          ? "luna_library 테이블이 없습니다. 마이그레이션을 실행하세요."
          : duplicate
            ? "같은 slug 가 이미 있습니다."
            : error.message
      },
      { status: missing ? 503 : duplicate ? 409 : 500 }
    );
  }
  return NextResponse.json({ item: data });
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

  const parsed = parseLibraryBody(body, false);
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
    .from("luna_library")
    .update(update)
    .eq("slug", slug)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[luna/library] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item: data });
}
