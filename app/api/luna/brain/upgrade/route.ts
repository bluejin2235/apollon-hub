import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { formatPromptNumber } from "@/lib/luna/prompts";
import { getSelfUpgradeStatus } from "@/lib/luna/self-upgrade";

export const runtime = "nodejs";

export type UpgradeHistoryItem = {
  id: string;
  target_id: string;
  prompt_number: string | null;
  prompt_title: string | null;
  version: number;
  prev_version: number | null;
  changed_by_luna: boolean;
  editor_name: string | null;
  change_summary: string | null;
  prediction: string | null;
  verify_result: string | null;
  verify_note: string | null;
  score_from: number | null;
  score_to: number | null;
  score_total: number | null;
  is_revert: boolean;
  reverted_later: boolean;
  created_at: string;
};

/**
 * verify_note 는 self-upgrade 가 쓰는 두 가지 형태만 나온다.
 *   "회귀 통과 11/20"        → to=11, total=20
 *   "회귀 점수 하락 9/20 → 8/20" → from=9, to=8, total=20
 */
function parseScores(note: string | null): {
  from: number | null;
  to: number | null;
  total: number | null;
} {
  if (!note) return { from: null, to: null, total: null };
  const pairs = [...note.matchAll(/(\d+)\s*\/\s*(\d+)/g)].map((m) => ({
    score: Number(m[1]),
    total: Number(m[2])
  }));
  if (pairs.length === 0) return { from: null, to: null, total: null };
  if (pairs.length === 1) {
    return { from: null, to: pairs[0]!.score, total: pairs[0]!.total };
  }
  const first = pairs[0]!;
  const last = pairs[pairs.length - 1]!;
  return { from: first.score, to: last.score, total: last.total };
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
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = await getSelfUpgradeStatus(admin);

  // 루나·사람 변경을 모두 보여준다 (listLunaUpgradeHistory 는 루나 것만 반환)
  const { data: versions, error } = await admin
    .from("luna_prompt_versions")
    .select(
      "id, target_id, version, change_summary, prediction, changed_by, changed_by_luna, verify_result, verify_note, created_at"
    )
    .eq("target_type", "prompt")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.error("[luna/brain/upgrade] versions", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = versions ?? [];
  const promptIds = Array.from(
    new Set(rows.map((v) => v.target_id as string).filter(Boolean))
  );
  const editorIds = Array.from(
    new Set(
      rows
        .map((v) => v.changed_by)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );

  const promptById = new Map<
    string,
    { title: string; number: string; version: number }
  >();
  if (promptIds.length > 0) {
    const { data: prompts } = await admin
      .from("luna_prompts")
      .select("id, title, level, kind, sort_order, version")
      .in("id", promptIds);
    for (const p of prompts ?? []) {
      promptById.set(p.id as string, {
        title: (p.title as string) || "제목 없음",
        number: formatPromptNumber({
          level: String(p.level),
          kind: typeof p.kind === "string" ? p.kind : undefined,
          sort_order: typeof p.sort_order === "number" ? p.sort_order : null
        }),
        version: typeof p.version === "number" ? p.version : 0
      });
    }
  }

  const nameById = new Map<string, string>();
  if (editorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", editorIds);
    for (const p of profiles ?? []) {
      nameById.set(p.id as string, ((p.name as string) || "").trim() || "이름 없음");
    }
  }

  // 같은 프롬프트에서 뒤에 "되돌림" 버전이 있으면 되돌려진 변경으로 표시
  const revertedTargets = new Map<string, number>();
  for (const v of [...rows].reverse()) {
    const summary = typeof v.change_summary === "string" ? v.change_summary : "";
    if (summary.includes("되돌림")) {
      revertedTargets.set(
        v.target_id as string,
        Math.max(revertedTargets.get(v.target_id as string) ?? 0, Number(v.version) || 0)
      );
    }
  }

  const history: UpgradeHistoryItem[] = rows.map((v) => {
    const p = promptById.get(v.target_id as string);
    const version = Number(v.version) || 0;
    const summary = typeof v.change_summary === "string" ? v.change_summary : null;
    const scores = parseScores(
      typeof v.verify_note === "string" ? v.verify_note : null
    );
    const revertVersion = revertedTargets.get(v.target_id as string) ?? 0;
    return {
      id: v.id as string,
      target_id: v.target_id as string,
      prompt_number: p?.number ?? null,
      prompt_title: p?.title ?? null,
      version,
      prev_version: version > 1 ? version - 1 : null,
      changed_by_luna: v.changed_by_luna === true,
      editor_name:
        typeof v.changed_by === "string" ? nameById.get(v.changed_by) ?? null : null,
      change_summary: summary,
      prediction: typeof v.prediction === "string" ? v.prediction : null,
      verify_result: typeof v.verify_result === "string" ? v.verify_result : null,
      verify_note: typeof v.verify_note === "string" ? v.verify_note : null,
      score_from: scores.from,
      score_to: scores.to,
      score_total: scores.total,
      is_revert: Boolean(summary?.includes("되돌림")),
      reverted_later: revertVersion > version,
      created_at: v.created_at as string
    };
  });

  const suggestion = status.revert_suggestion;
  const pending = suggestion
    ? {
        ...suggestion,
        prompt_number: promptById.get(suggestion.prompt_id)?.number ?? null
      }
    : null;

  return NextResponse.json({
    pending,
    last_run: status.last_run,
    history
  });
}

/** DELETE — 되돌림 제안 반려(무시) */
export async function DELETE(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("luna_settings")
    .delete()
    .eq("key", "self_upgrade_revert_suggestion");

  if (error) {
    console.error("[luna/brain/upgrade] dismiss", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
