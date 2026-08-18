import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { stripConfirmClaimDisplay } from "@/lib/luna/candidate-format";
import {
  clipRejectNote,
  hasRejectMeta,
  rejectActionLabel
} from "@/lib/luna/reject-note";

export const runtime = "nodejs";

const LIMIT = 80;

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
  return { admin };
}

function asMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(d);
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { data: rows, error } = await admin
    .from("luna_learnings")
    .select("id, content, meta, resolved_at, updated_at, created_at")
    .or("meta->>reject_note.not.is.null,meta->>reject_action.not.is.null")
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error("[luna/candidates/rejects] select", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (rows ?? [])
    .map((row) => {
      const meta = asMeta(row.meta);
      if (!hasRejectMeta(meta)) return null;
      const at =
        typeof row.resolved_at === "string" && row.resolved_at
          ? row.resolved_at
          : typeof row.updated_at === "string"
            ? row.updated_at
            : typeof row.created_at === "string"
              ? row.created_at
              : "";
      const content =
        typeof row.content === "string" ? row.content.trim() : "";
      return {
        id: row.id as string,
        when: formatKst(at),
        at,
        content: stripConfirmClaimDisplay(content),
        action: rejectActionLabel(meta.reject_action) || "—",
        note: clipRejectNote(meta.reject_note)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, LIMIT);

  return NextResponse.json({ items });
}
