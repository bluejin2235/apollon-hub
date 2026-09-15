import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertLunaSignals } from "@/lib/luna/signals";
import type { InsertLunaSignalInput } from "@/lib/luna/signals-shared";

function asMeta(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export type BackfillSignalsReport = {
  thumbs: number;
  link_reject: number;
  failures: number;
  total: number;
  by_kind: { negative: number; positive: number; correction: number };
};

async function hasBackfillSource(
  admin: SupabaseClient,
  source: string
): Promise<boolean> {
  const { count } = await admin
    .from("luna_signals")
    .select("id", { count: "exact", head: true })
    .eq("source", source)
    .contains("context", { backfill: true });
  return (count ?? 0) > 0;
}

/** 과거 신호 → luna_signals 한 번 옮겨 담기 (source별 멱등) */
export async function backfillLunaSignals(
  admin: SupabaseClient
): Promise<BackfillSignalsReport> {
  const batch: InsertLunaSignalInput[] = [];
  let thumbs = 0;
  let linkReject = 0;
  let failures = 0;

  if (!(await hasBackfillSource(admin, "thumbs"))) {
    const { data: msgs } = await admin
      .from("luna_messages")
      .select("id, conversation_id, created_at, metadata")
      .eq("role", "assistant")
      .contains("metadata", { feedback: "bad" })
      .limit(500);
    for (const m of msgs ?? []) {
      const meta = asMeta(m.metadata);
      if (meta.feedback !== "bad") continue;
      const at =
        typeof meta.feedback_at === "string" && meta.feedback_at
          ? meta.feedback_at
          : typeof m.created_at === "string"
            ? m.created_at
            : undefined;
      batch.push({
        kind: "negative",
        source: "thumbs",
        subject_type: "answer",
        subject_id: m.id as string,
        reason:
          typeof meta.feedback_reason === "string" ? meta.feedback_reason : null,
        note: typeof meta.feedback_note === "string" ? meta.feedback_note : null,
        context: {
          backfill: true,
          conversation_id: m.conversation_id,
          from: "luna_messages"
        },
        created_at: at
      });
      thumbs += 1;
    }
  }

  if (!(await hasBackfillSource(admin, "link_reject"))) {
    const { data: rejected } = await admin
      .from("luna_links")
      .select("id, evidence, confirmed_by, created_at")
      .eq("kind", "same")
      .eq("status", "rejected")
      .limit(500);
    for (const row of rejected ?? []) {
      const ev = asMeta(row.evidence);
      batch.push({
        kind: "negative",
        source: "link_reject",
        subject_type: "link",
        subject_id: row.id as string,
        reason: typeof ev.reject_reason === "string" ? ev.reject_reason : null,
        note: typeof ev.reject_note === "string" ? ev.reject_note : null,
        context: {
          backfill: true,
          from_title: ev.from_title ?? null,
          to_title: ev.to_title ?? null,
          from: "luna_links"
        },
        user_id: typeof row.confirmed_by === "string" ? row.confirmed_by : null,
        created_at: typeof row.created_at === "string" ? row.created_at : undefined
      });
      linkReject += 1;
    }
  }

  const needFailures =
    !(await hasBackfillSource(admin, "search_zero")) &&
    !(await hasBackfillSource(admin, "followup")) &&
    !(await hasBackfillSource(admin, "chat_correction"));

  if (needFailures) {
    let fromFail = 0;
    for (;;) {
      const { data: fails, error: failErr } = await admin
        .from("luna_failures")
        .select("id, message_id, asked_by, signal, question, created_at")
        .order("created_at", { ascending: true })
        .range(fromFail, fromFail + 199);
      if (failErr) {
        console.error("[backfill] failures", failErr);
        break;
      }
      const part = fails ?? [];
      for (const f of part) {
        const primary = String(f.signal ?? "");
        if (primary === "thumbs_down") continue;
        let source: InsertLunaSignalInput["source"] = "followup";
        let kind: InsertLunaSignalInput["kind"] = "negative";
        if (primary === "correction") {
          source = "chat_correction";
          kind = "correction";
        } else if (primary === "zero_search" || primary === "not_found") {
          source = "search_zero";
        }
        batch.push({
          kind,
          source,
          subject_type: f.message_id ? "answer" : "failure",
          subject_id: (f.message_id as string) || (f.id as string),
          reason: primary || null,
          note: typeof f.question === "string" ? f.question.slice(0, 200) : null,
          context: {
            backfill: true,
            failure_id: f.id,
            signals: [primary],
            from: "luna_failures"
          },
          user_id: typeof f.asked_by === "string" ? f.asked_by : null,
          created_at:
            typeof f.created_at === "string" ? f.created_at : undefined
        });
        failures += 1;
      }
      if (part.length < 200) break;
      fromFail += 200;
    }
  }

  let inserted = 0;
  for (let i = 0; i < batch.length; i += 100) {
    inserted += await insertLunaSignals(admin, batch.slice(i, i + 100));
  }

  const byKind = await countKinds(admin);
  return {
    thumbs,
    link_reject: linkReject,
    failures,
    total: inserted,
    by_kind: byKind
  };
}

async function countKinds(admin: SupabaseClient) {
  const out = { negative: 0, positive: 0, correction: 0 };
  for (const kind of Object.keys(out) as Array<keyof typeof out>) {
    const { count } = await admin
      .from("luna_signals")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind);
    out[kind] = count ?? 0;
  }
  return out;
}
