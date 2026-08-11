import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { triggerAutoExam } from "@/lib/luna/eval-exam";
import { lunaNotify } from "@/lib/luna/notify";
import type {
  LunaPromptKind,
  LunaPromptLevel,
  LunaPromptRow,
  LunaPromptVersionRow
} from "@/lib/luna/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEVEL_ORDER: Record<string, number> = { L1: 0, L2: 1, L3: 2 };
const KIND_ORDER: Record<string, number> = {
  identity: 0,
  perspective: 1,
  role: 2,
  task: 3,
  system: 4
};

const PROMPT_SELECT =
  "id, level, kind, prompt_key, group_name, title, description, purpose, content, is_active, sort_order, owner_id, version, created_at, updated_at";

const GROUP_SELECT =
  "group_key, label, tagline, description, when_runs, sort_order";

function sortPrompts<T extends { level: string; kind: string; sort_order: number; created_at: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const levelDiff = (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99);
    if (levelDiff !== 0) return levelDiff;
    const kindDiff = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    if (kindDiff !== 0) return kindDiff;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });
}

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
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const isAdmin = await isSuperAdminUser(admin, user);

  if (!isAdmin) {
    const { data, error } = await admin
      .from("luna_prompts")
      .select("id, level, kind, title, description, sort_order, created_at")
      .eq("level", "L2")
      .eq("is_active", true);

    if (error) {
      console.error("[luna/prompts] GET public", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const prompts = sortPrompts(
      (data ?? []) as Array<{
        id: string;
        level: string;
        kind: string;
        title: string;
        description: string | null;
        sort_order: number;
        created_at: string;
      }>
    ).map(({ id, level, kind, title, description, sort_order }) => ({
      id,
      level,
      kind,
      title,
      description,
      sort_order
    }));

    return NextResponse.json({ prompts });
  }

  const activeOnly = request.nextUrl.searchParams.get("active") === "true";
  const levelFilter = request.nextUrl.searchParams.get("level");

  let query = admin.from("luna_prompts").select(PROMPT_SELECT);
  if (activeOnly) {
    query = query.eq("is_active", true);
  }
  if (levelFilter === "L2") {
    query = query.eq("level", "L2");
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/prompts] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prompts = sortPrompts((data ?? []) as LunaPromptRow[]);

  const ids = prompts.map((p) => p.id);

  const versionByTarget = new Map<
    string,
    { version: number; changed_by: string | null; changed_by_luna: boolean; editor_name: string | null }
  >();
  const versionsByTarget = new Map<string, LunaPromptVersionRow[]>();

  if (ids.length > 0) {
    const { data: versions, error: verError } = await admin
      .from("luna_prompt_versions")
      .select(
        "id, target_type, target_id, version, content, change_summary, changed_by, changed_by_luna, created_at, prediction, verify_run_id, verify_result, verify_note, verified_at"
      )
      .eq("target_type", "prompt")
      .in("target_id", ids)
      .order("version", { ascending: false });

    if (verError) {
      console.error("[luna/prompts] GET versions", verError);
      return NextResponse.json({ error: verError.message }, { status: 500 });
    }

    const editorIds = Array.from(
      new Set(
        (versions ?? [])
          .map((v) => v.changed_by)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const nameById = new Map<string, string>();
    if (editorIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, name")
        .in("id", editorIds);
      for (const p of profiles ?? []) {
        if (typeof p.id === "string") {
          nameById.set(p.id, typeof p.name === "string" ? p.name : "");
        }
      }
    }

    for (const v of versions ?? []) {
      const targetId = v.target_id as string;
      const editorName =
        typeof v.changed_by === "string" ? nameById.get(v.changed_by) ?? null : null;
      const verifyRaw = v.verify_result;
      const verifyResult =
        verifyRaw === "confirmed" ||
        verifyRaw === "refuted" ||
        verifyRaw === "inconclusive"
          ? verifyRaw
          : null;
      const row: LunaPromptVersionRow = {
        id: v.id as string,
        target_type: v.target_type as string,
        target_id: targetId,
        version: v.version as number,
        content: (v.content ?? {}) as LunaPromptVersionRow["content"],
        change_summary: (v.change_summary as string | null) ?? null,
        changed_by: (v.changed_by as string | null) ?? null,
        changed_by_luna: Boolean(v.changed_by_luna),
        created_at: v.created_at as string,
        editor_name: editorName,
        prediction:
          typeof v.prediction === "string" ? v.prediction : null,
        verify_run_id:
          typeof v.verify_run_id === "string" ? v.verify_run_id : null,
        verify_result: verifyResult,
        verify_note:
          typeof v.verify_note === "string" ? v.verify_note : null,
        verified_at:
          typeof v.verified_at === "string" ? v.verified_at : null
      };
      const list = versionsByTarget.get(targetId) ?? [];
      list.push(row);
      versionsByTarget.set(targetId, list);
      if (!versionByTarget.has(targetId)) {
        versionByTarget.set(targetId, {
          version: row.version,
          changed_by: row.changed_by,
          changed_by_luna: row.changed_by_luna,
          editor_name: editorName
        });
      }
    }
  }

  const enriched = prompts.map((p) => {
    const latest = versionByTarget.get(p.id);
    return {
      ...p,
      last_editor_name: latest?.editor_name ?? null,
      changed_by_luna: latest?.changed_by_luna ?? false,
      versions: versionsByTarget.get(p.id) ?? []
    };
  });

  const { data: groupsData, error: groupsError } = await admin
    .from("luna_prompt_groups")
    .select(GROUP_SELECT)
    .order("sort_order", { ascending: true });

  if (groupsError) {
    console.error("[luna/prompts] GET groups", groupsError);
    return NextResponse.json({ error: groupsError.message }, { status: 500 });
  }

  return NextResponse.json({
    prompts: enriched,
    groups: groupsData ?? []
  });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { user, admin } = gate as {
    user: NonNullable<Awaited<ReturnType<typeof getApiUser>>>;
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: {
    id?: string;
    title?: string;
    description?: string | null;
    purpose?: string | null;
    content?: string;
    owner_id?: string | null;
    sort_order?: number;
    is_active?: boolean;
    change_summary?: string;
    prediction?: string;
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

  const hasTitle = typeof body.title === "string";
  const hasDescription = "description" in body;
  const hasPurpose = "purpose" in body;
  const hasContent = typeof body.content === "string";
  const hasOwner = "owner_id" in body;
  const hasSort = typeof body.sort_order === "number";
  const hasActive = typeof body.is_active === "boolean";
  const contentFieldsTouched =
    hasTitle || hasDescription || hasPurpose || hasContent || hasOwner || hasSort;
  const activeOnly = hasActive && !contentFieldsTouched;

  const { data: current, error: curError } = await admin
    .from("luna_prompts")
    .select(PROMPT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (curError) {
    console.error("[luna/prompts] PATCH load", curError);
    return NextResponse.json({ error: curError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (activeOnly) {
    const { data, error } = await admin
      .from("luna_prompts")
      .update({
        is_active: body.is_active,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select(PROMPT_SELECT)
      .maybeSingle();

    if (error) {
      console.error("[luna/prompts] PATCH active", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ prompt: data });
  }

  const changeSummary =
    typeof body.change_summary === "string" ? body.change_summary.trim() : "";
  if (!changeSummary) {
    return NextResponse.json({ error: "change_summary is required" }, { status: 400 });
  }
  const prediction =
    typeof body.prediction === "string" ? body.prediction.trim() : "";
  if (!prediction) {
    return NextResponse.json({ error: "prediction is required" }, { status: 400 });
  }

  const nextTitle = hasTitle ? body.title!.trim() : (current.title as string);
  const nextDescription = hasDescription
    ? typeof body.description === "string"
      ? body.description.trim()
      : null
    : ((current.description as string | null) ?? null);
  const nextPurpose = hasPurpose
    ? typeof body.purpose === "string"
      ? body.purpose.trim()
      : null
    : ((current.purpose as string | null) ?? null);
  const nextContent = hasContent ? body.content!.trim() : (current.content as string);
  const nextOwnerId = hasOwner
    ? typeof body.owner_id === "string" && body.owner_id.trim()
      ? body.owner_id.trim()
      : null
    : ((current.owner_id as string | null) ?? null);
  const nextSortOrder = hasSort
    ? Math.trunc(body.sort_order!)
    : (current.sort_order as number);
  const nextActive = hasActive ? Boolean(body.is_active) : Boolean(current.is_active);
  const nextVersion = (current.version as number) + 1;
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await admin
    .from("luna_prompts")
    .update({
      title: nextTitle,
      description: nextDescription,
      purpose: nextPurpose,
      content: nextContent,
      owner_id: nextOwnerId,
      sort_order: nextSortOrder,
      is_active: nextActive,
      version: nextVersion,
      updated_at: now
    })
    .eq("id", id)
    .select(PROMPT_SELECT)
    .maybeSingle();

  if (updateError) {
    console.error("[luna/prompts] PATCH update", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const versionContent = {
    title: nextTitle,
    description: nextDescription,
    purpose: nextPurpose,
    content: nextContent,
    owner_id: nextOwnerId,
    sort_order: nextSortOrder
  };

  const { error: verInsertError } = await admin.from("luna_prompt_versions").insert({
    target_type: "prompt",
    target_id: id,
    version: nextVersion,
    content: versionContent,
    change_summary: changeSummary,
    prediction,
    changed_by: user.id,
    changed_by_luna: false
  });

  if (verInsertError) {
    console.error("[luna/prompts] PATCH version", verInsertError);
    return NextResponse.json({ error: verInsertError.message }, { status: 500 });
  }

  await lunaNotify(
    admin,
    "prompt_change",
    "프롬프트 변경",
    `「${nextTitle}」 v${nextVersion} — ${changeSummary}`,
    {
      level: "info",
      meta: { prompt_id: id, version: nextVersion }
    }
  );

  await triggerAutoExam(admin, "prompt_change", user.id);

  return NextResponse.json({ prompt: updated });
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    user: NonNullable<Awaited<ReturnType<typeof getApiUser>>>;
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

  let body: { level?: string; kind?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const level = body.level as LunaPromptLevel | undefined;
  const kind = body.kind as LunaPromptKind | undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (
    (level !== "L1" && level !== "L2" && level !== "L3") ||
    (kind !== "identity" &&
      kind !== "perspective" &&
      kind !== "role" &&
      kind !== "task" &&
      kind !== "system") ||
    !title
  ) {
    return NextResponse.json(
      { error: "level, kind, and title are required" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("luna_prompts")
    .insert({
      level,
      kind,
      title,
      description: "",
      purpose: "",
      content: "",
      is_active: true,
      sort_order: 0,
      version: 1
    })
    .select("id")
    .single();

  if (error) {
    console.error("[luna/prompts] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate as {
    user: NonNullable<Awaited<ReturnType<typeof getApiUser>>>;
    admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
  };

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

  const { data: current, error: curError } = await admin
    .from("luna_prompts")
    .select("id, kind, prompt_key")
    .eq("id", id)
    .maybeSingle();

  if (curError) {
    console.error("[luna/prompts] DELETE load", curError);
    return NextResponse.json({ error: curError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (current.kind === "identity" || current.prompt_key) {
    return NextResponse.json(
      { error: "identity or keyed prompts cannot be deleted" },
      { status: 400 }
    );
  }

  const { error } = await admin.from("luna_prompts").delete().eq("id", id);
  if (error) {
    console.error("[luna/prompts] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
