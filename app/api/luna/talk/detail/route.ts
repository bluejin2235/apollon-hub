import { NextRequest, NextResponse } from "next/server";
import { requireLunaAdmin } from "@/lib/luna-admin/auth";

export const runtime = "nodejs";

const MAX_MESSAGES = 100;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, limit = 500): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function sources(value: unknown, kind: string) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((raw) => {
    const item = record(raw);
    return {
      kind: text(item.type, 30) || kind,
      title: text(item.title, 300),
      path: text(item.raw_path ?? item.nas_path, 900),
      drive: text(item.drive, 3),
      via_link: text(item.via_link, 50),
      url: /^https:\/\//.test(text(item.url, 1500)) ? text(item.url, 1500) : null
    };
  });
}

export async function GET(request: NextRequest) {
  const gate = await requireLunaAdmin(request);
  if ("error" in gate) return gate.error;
  const id = request.nextUrl.searchParams.get("conversation_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid conversation ID" }, { status: 400 });
  }

  const { data: conversation, error: convError } = await gate.admin
    .from("luna_conversations")
    .select("id, title, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (convError) {
    return NextResponse.json({ error: "Conversation lookup failed" }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data, error } = await gate.admin
    .from("luna_messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES + 1);
  if (error) {
    return NextResponse.json({ error: "Messages lookup failed" }, { status: 500 });
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      updated_at: conversation.updated_at
    },
    truncated: (data?.length ?? 0) > MAX_MESSAGES,
    messages: (data ?? []).slice(0, MAX_MESSAGES).map((row) => {
      const meta = record(row.metadata);
      const evidence = record(meta.search_evidence);
      return {
        id: row.id,
        role: row.role,
        content: text(row.content, 12000),
        content_truncated: typeof row.content === "string" && row.content.length > 12000,
        created_at: row.created_at,
        search: {
          retrieved_candidate_peak: count(evidence.retrieved_candidate_peak),
          displayed_source_count: count(evidence.displayed_source_count),
          cards: sources(meta.cards, "자료"),
          notion: sources(meta.notion_sources, "노션"),
          wiki: sources(meta.wiki_sources, "위키")
        }
      };
    })
  });
}
