import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  DEPARTMENT_LENS_SEED,
  listDepartmentLens
} from "@/lib/luna/department-lens";

export const runtime = "nodejs";

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

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  try {
    const mappings = await listDepartmentLens(admin);
    const { data: lenses, error } = await admin
      .from("luna_prompts")
      .select("prompt_key, title")
      .eq("level", "L2")
      .eq("kind", "perspective")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[luna/department-lens] lenses", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      mappings,
      lenses: (lenses ?? []).map((r) => ({
        prompt_key: r.prompt_key,
        title: r.title
      })),
      table_ready: mappings.some((m) => m.updated_at)
    });
  } catch (err) {
    console.error("[luna/department-lens] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: {
    department?: string;
    lens_prompt_key?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const department = typeof body.department === "string" ? body.department.trim() : "";
  if (!department) {
    return NextResponse.json({ error: "department is required" }, { status: 400 });
  }

  const lensKey =
    typeof body.lens_prompt_key === "string" && body.lens_prompt_key.trim()
      ? body.lens_prompt_key.trim()
      : null;

  if (lensKey) {
    const { data: lens, error: lensError } = await admin
      .from("luna_prompts")
      .select("prompt_key")
      .eq("prompt_key", lensKey)
      .eq("level", "L2")
      .eq("kind", "perspective")
      .eq("is_active", true)
      .maybeSingle();
    if (lensError) {
      console.error("[luna/department-lens] validate", lensError);
      return NextResponse.json({ error: lensError.message }, { status: 500 });
    }
    if (!lens) {
      return NextResponse.json({ error: "unknown lens_prompt_key" }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from("luna_department_lens")
    .upsert(
      {
        department,
        lens_prompt_key: lensKey,
        updated_at: new Date().toISOString()
      },
      { onConflict: "department" }
    )
    .select("department, lens_prompt_key, updated_at")
    .maybeSingle();

  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    if (code === "42P01" || code === "PGRST205") {
      return NextResponse.json(
        {
          error:
            "luna_department_lens 테이블이 없습니다. 마이그레이션 SQL을 먼저 실행하세요.",
          seed: DEPARTMENT_LENS_SEED
        },
        { status: 409 }
      );
    }
    console.error("[luna/department-lens] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ mapping: data });
}
