import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  clipFeedbackNote,
  FEEDBACK_REASON_LABELS,
  isFeedbackReason
} from "@/lib/luna/feedback";

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

function preview(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
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
    .from("luna_messages")
    .select("id, conversation_id, content, created_at, metadata")
    .eq("role", "assistant")
    .contains("metadata", { feedback: "bad" })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[luna/talk/thumbs] select", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const down = (rows ?? [])
    .map((row) => {
      const meta = asMeta(row.metadata);
      if (meta.feedback !== "bad") return null;
      const at =
        typeof meta.feedback_at === "string" && meta.feedback_at
          ? meta.feedback_at
          : typeof row.created_at === "string"
            ? row.created_at
            : "";
      const reasonRaw = meta.feedback_reason;
      return {
        id: row.id as string,
        conversation_id: row.conversation_id as string,
        content: typeof row.content === "string" ? row.content : "",
        created_at: typeof row.created_at === "string" ? row.created_at : at,
        at,
        reason: isFeedbackReason(reasonRaw) ? reasonRaw : null,
        note: clipFeedbackNote(meta.feedback_note)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, LIMIT);

  const convIds = Array.from(new Set(down.map((r) => r.conversation_id).filter(Boolean)));

  const userByConv = new Map<string, string>();
  if (convIds.length > 0) {
    const { data: convs } = await admin
      .from("luna_conversations")
      .select("id, user_id")
      .in("id", convIds);
    for (const c of convs ?? []) {
      userByConv.set(c.id as string, (c.user_id as string) || "");
    }
  }

  const userIds = Array.from(new Set([...userByConv.values()].filter(Boolean)));
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      const name = typeof p.name === "string" ? p.name.trim() : "";
      nameByUser.set(p.id as string, name || "—");
    }
  }

  const userMsgsByConv = new Map<string, Array<{ content: string; created_at: string }>>();
  if (convIds.length > 0) {
    const { data: userMsgs } = await admin
      .from("luna_messages")
      .select("conversation_id, content, created_at")
      .eq("role", "user")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true })
      .limit(2000);
    for (const m of userMsgs ?? []) {
      const cid = m.conversation_id as string;
      const list = userMsgsByConv.get(cid) ?? [];
      list.push({
        content: typeof m.content === "string" ? m.content : "",
        created_at: typeof m.created_at === "string" ? m.created_at : ""
      });
      userMsgsByConv.set(cid, list);
    }
  }

  const items = down.map((row) => {
    const users = userMsgsByConv.get(row.conversation_id) ?? [];
    const asked =
      [...users]
        .reverse()
        .find((m) => !m.created_at || m.created_at <= row.created_at)?.content ?? "";
    const userId = userByConv.get(row.conversation_id) ?? "";
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      when: formatKst(row.at || row.created_at),
      at: row.at || row.created_at,
      user_name: nameByUser.get(userId) || "—",
      question: preview(asked, 120),
      answer: preview(row.content, 120),
      reason: row.reason,
      reason_label: row.reason ? FEEDBACK_REASON_LABELS[row.reason] : null,
      note: row.note
    };
  });

  return NextResponse.json({ items, total: items.length });
}
