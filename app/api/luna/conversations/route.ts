import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";

export const runtime = "nodejs";

export type LunaConversationRow = {
  id: string;
  user_id: string;
  title: string;
  engine: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT =
  "id, user_id, title, engine, project_id, created_at, updated_at";

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
    .from("luna_conversations")
    .select(SELECT)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[luna/conversations] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: (data ?? []) as LunaConversationRow[] });
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

  let body: { project_id?: string | null } = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as { project_id?: string | null };
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const insert: Record<string, unknown> = {
    user_id: user.id,
    title: "새 대화",
    engine: "auto"
  };

  if (typeof body.project_id === "string" && body.project_id.trim()) {
    const projectId = body.project_id.trim();
    const { data: project, error: projectError } = await admin
      .from("luna_projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (projectError) {
      console.error("[luna/conversations] POST project", projectError);
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    insert.project_id = projectId;
  }

  const { data, error } = await admin
    .from("luna_conversations")
    .insert(insert)
    .select(SELECT)
    .single();

  if (error) {
    console.error("[luna/conversations] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: data as LunaConversationRow }, { status: 201 });
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
    title?: string;
    engine?: string;
    project_id?: string | null;
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
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.engine === "string") patch.engine = body.engine;

  if (body.project_id === null) {
    patch.project_id = null;
  } else if (typeof body.project_id === "string") {
    const projectId = body.project_id.trim();
    if (!projectId) {
      patch.project_id = null;
    } else {
      const { data: project, error: projectError } = await admin
        .from("luna_projects")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (projectError) {
        console.error("[luna/conversations] PATCH project", projectError);
        return NextResponse.json({ error: projectError.message }, { status: 500 });
      }
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      patch.project_id = projectId;
    }
  }

  if (
    patch.title === undefined &&
    patch.engine === undefined &&
    patch.project_id === undefined
  ) {
    return NextResponse.json(
      { error: "title, engine, or project_id is required" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("luna_conversations")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SELECT)
    .maybeSingle();

  if (error) {
    console.error("[luna/conversations] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation: data as LunaConversationRow });
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
    .from("luna_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[luna/conversations] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
