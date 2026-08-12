import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isGlossaryCandidate } from "@/lib/luna/candidate-format";

export const runtime = "nodejs";

export type GlossaryCategory = "common" | "interior" | "hw";

export type GlossaryListItem = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  term_zh_pron: string | null;
  category: GlossaryCategory;
};

export type GlossaryVersionItem = {
  id: string;
  version: number;
  editor_type: "human" | "luna";
  editor_name: string | null;
  change_note: string | null;
  created_at: string;
};

const TERM_SELECT =
  "id, term_ko, term_en, term_zh, term_zh_pron, category, definition, version, updated_at, updated_by";

const LIST_SELECT = "id, term_ko, term_en, term_zh, term_zh_pron, category";

function normalizeCategory(raw: unknown): GlossaryCategory {
  return raw === "interior" || raw === "hw" ? raw : "common";
}

function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/** RPC 안의 auth.uid() 가 풀리도록 호출자 JWT 를 단 클라이언트 */
function getUserSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function bearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/** 지식후보함에 쌓인 용어형 후보 수 — 상단 "확인 필요 N" */
async function countTermCandidates(
  admin: ReturnType<typeof getServiceSupabase>
): Promise<number> {
  if (!admin) return 0;
  const { data, error } = await admin
    .from("luna_learnings")
    .select("category, meta, snoozed_until")
    .eq("status", "candidate")
    .neq("category", "identity");
  if (error) {
    console.error("[glossary] candidate count", error);
    return 0;
  }
  const now = Date.now();
  return (data ?? []).filter((row) => {
    const until = row.snoozed_until
      ? new Date(String(row.snoozed_until)).getTime()
      : null;
    if (until && Number.isFinite(until) && until > now) return false;
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null;
    return isGlossaryCandidate(meta, row.category as string | null);
  }).length;
}

/** 편집자 표시 이름은 profiles 기준 (auth 메타데이터에는 비어 있는 경우가 많다) */
async function resolveEditorNames(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, name").in("id", ids);
  for (const row of data ?? []) {
    const name = ((row.name as string) || "").trim();
    if (name) map.set(row.id as string, name);
  }
  return map;
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

  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const { data: term, error } = await admin
      .from("glossary_terms")
      .select(TERM_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[glossary] GET detail", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!term) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: versionRows } = await admin
      .from("glossary_versions")
      .select("id, version, editor_type, editor_name, edited_by, change_note, created_at")
      .eq("term_id", id)
      .order("version", { ascending: false })
      .limit(20);

    const editorIds = Array.from(
      new Set(
        (versionRows ?? [])
          .map((v) => v.edited_by)
          .filter((v): v is string => typeof v === "string" && Boolean(v))
      )
    );
    const nameById = await resolveEditorNames(admin, editorIds);

    const versions: GlossaryVersionItem[] = (versionRows ?? []).map((v) => ({
      id: v.id as string,
      version: Number(v.version) || 0,
      editor_type: v.editor_type === "luna" ? "luna" : "human",
      editor_name:
        (typeof v.edited_by === "string" ? nameById.get(v.edited_by) : null) ??
        text(v.editor_name),
      change_note: text(v.change_note),
      created_at: v.created_at as string
    }));

    return NextResponse.json({ term, versions });
  }

  const { data: terms, error } = await admin
    .from("glossary_terms")
    .select(LIST_SELECT)
    .order("term_ko", { ascending: true });

  if (error) {
    console.error("[glossary] GET list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    terms: terms ?? [],
    pending_candidates: await countTermCandidates(admin)
  });
}

/** 위키 방식 저장 — 검토 없이 즉시 반영, 버전 증가, 이력 기록 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  const token = bearer(request);
  if (!user || !token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: {
    id?: string | null;
    term_ko?: string;
    term_en?: string | null;
    term_zh?: string | null;
    term_zh_pron?: string | null;
    category?: string;
    definition?: string | null;
    change_note?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const termKo = typeof body.term_ko === "string" ? body.term_ko.trim() : "";
  if (!termKo) {
    return NextResponse.json({ error: "한국어 용어는 반드시 있어야 합니다." }, { status: 400 });
  }

  const termId = typeof body.id === "string" && body.id ? body.id : null;
  const payload = {
    term_ko: termKo,
    term_en: text(body.term_en),
    term_zh: text(body.term_zh),
    term_zh_pron: text(body.term_zh_pron),
    category: normalizeCategory(body.category),
    definition: text(body.definition)
  };
  const changeNote = text(body.change_note);

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName = ((profile?.name as string) || "").trim() || null;

  // save_term RPC 가 있으면 그것으로 (버전 증가 + 이력 기록이 한 트랜잭션)
  const userClient = getUserSupabase(token);
  if (userClient) {
    const { data, error } = await userClient.rpc("save_term", {
      p_term_id: termId,
      p_ko: payload.term_ko,
      p_en: payload.term_en,
      p_zh: payload.term_zh,
      p_zh_pron: payload.term_zh_pron,
      p_category: payload.category,
      p_definition: payload.definition,
      p_change_note: changeNote
    });

    if (!error) {
      const saved = (Array.isArray(data) ? data[0] : data) as
        | { id: string; version: number }
        | null;
      if (saved?.id) {
        // RPC 는 auth 메타데이터에서 이름을 읽으므로 profiles 이름으로 덮어쓴다
        if (editorName) {
          await admin
            .from("glossary_versions")
            .update({ editor_name: editorName })
            .eq("term_id", saved.id)
            .eq("version", saved.version);
        }
        return NextResponse.json({ term: saved });
      }
    } else if (error.code !== "PGRST202" && error.code !== "42883") {
      // RPC 가 존재하는데 실패한 경우만 오류로 본다
      console.error("[glossary] save_term", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // RPC 가 없을 때: 직접 update + versions insert
  let saved: { id: string; version: number } | null = null;
  if (termId) {
    const { data: current, error: readError } = await admin
      .from("glossary_terms")
      .select("version")
      .eq("id", termId)
      .maybeSingle();
    if (readError || !current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const nextVersion = (Number(current.version) || 1) + 1;
    const { data, error } = await admin
      .from("glossary_terms")
      .update({
        ...payload,
        version: nextVersion,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", termId)
      .select("id, version")
      .maybeSingle();
    if (error || !data) {
      console.error("[glossary] update", error);
      return NextResponse.json(
        { error: error?.message ?? "저장하지 못했습니다." },
        { status: 500 }
      );
    }
    saved = { id: data.id as string, version: Number(data.version) || nextVersion };
  } else {
    const { data, error } = await admin
      .from("glossary_terms")
      .insert({ ...payload, version: 1, created_by: user.id, updated_by: user.id })
      .select("id, version")
      .maybeSingle();
    if (error || !data) {
      console.error("[glossary] insert", error);
      return NextResponse.json(
        { error: error?.message ?? "저장하지 못했습니다." },
        { status: 500 }
      );
    }
    saved = { id: data.id as string, version: 1 };
  }

  // glossary_versions 에는 category 컬럼이 없다
  const { error: versionError } = await admin.from("glossary_versions").insert({
    term_id: saved.id,
    version: saved.version,
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    term_zh_pron: payload.term_zh_pron,
    definition: payload.definition,
    editor_type: "human",
    edited_by: user.id,
    editor_name: editorName,
    change_note: changeNote
  });
  if (versionError) {
    console.error("[glossary] version insert", versionError);
  }

  return NextResponse.json({ term: saved });
}
