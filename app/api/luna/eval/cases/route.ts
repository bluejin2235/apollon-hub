import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

const CASE_SELECT =
  "id, question, expectation, category, connectors, sort_order, is_active, created_at, tier, must_pass, quality";

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

function parseConnectors(raw: unknown): { notion: boolean; web: boolean; nas: boolean } {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    notion: obj.notion === true,
    web: obj.web === true,
    nas: obj.nas === true
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  const { data, error } = await admin
    .from("luna_eval_cases")
    .select(CASE_SELECT)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[luna/eval/cases] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ cases: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: {
    question?: string;
    expectation?: string;
    category?: string;
    connectors?: unknown;
    sort_order?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_cases")
    .insert({
      question,
      expectation:
        typeof body.expectation === "string" ? body.expectation.trim() : "",
      category: typeof body.category === "string" ? body.category.trim() : "",
      connectors: parseConnectors(body.connectors),
      sort_order:
        typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
          ? Math.trunc(body.sort_order)
          : 0,
      is_active: true
    })
    .select(CASE_SELECT)
    .single();

  if (error) {
    console.error("[luna/eval/cases] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ case: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: {
    id?: string;
    question?: string;
    expectation?: string;
    category?: string;
    connectors?: unknown;
    sort_order?: number;
    is_active?: boolean;
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

  const patch: Record<string, unknown> = {};
  if (typeof body.question === "string") patch.question = body.question.trim();
  if (typeof body.expectation === "string") patch.expectation = body.expectation.trim();
  if (typeof body.category === "string") patch.category = body.category.trim();
  if ("connectors" in body) patch.connectors = parseConnectors(body.connectors);
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    patch.sort_order = Math.trunc(body.sort_order);
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_cases")
    .update(patch)
    .eq("id", id)
    .select(CASE_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[luna/eval/cases] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ case: data });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: { id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_cases")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[luna/eval/cases] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
