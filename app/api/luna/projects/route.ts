import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";

export const runtime = "nodejs";

export type LunaProjectRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  project_code: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT =
  "id, user_id, name, description, project_code, created_at, updated_at";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("luna_projects")
    .select(SELECT)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[luna/projects] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: (data ?? []) as LunaProjectRow[] });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; description?: string; project_code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const insert: Record<string, unknown> = {
    user_id: user.id,
    name
  };
  if (typeof body.description === "string") {
    insert.description = body.description.trim() || null;
  }
  if (typeof body.project_code === "string") {
    insert.project_code = body.project_code.trim() || null;
  }

  const { data, error } = await admin
    .from("luna_projects")
    .insert(insert)
    .select(SELECT)
    .single();

  if (error) {
    console.error("[luna/projects] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data as LunaProjectRow }, { status: 201 });
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
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    id?: string;
    name?: string;
    description?: string;
    project_code?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = name;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim() || null;
  }
  if (typeof body.project_code === "string") {
    patch.project_code = body.project_code.trim() || null;
  }

  if (
    patch.name === undefined &&
    patch.description === undefined &&
    patch.project_code === undefined
  ) {
    return NextResponse.json(
      { error: "name, description, or project_code is required" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("luna_projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.error("[luna/projects] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ project: data as LunaProjectRow });
}

export async function DELETE(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[luna/projects] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
