/**
 * 같은 것 — 불용어를 뺀 유사도로 자동 확정을 다시 본다.
 * 스크립트에서도 쓰므로 server-only 없음.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { LINK_AUTO_SAVE } from "@/lib/luna-admin/confidence";
import {
  extractDateCode,
  sameCoreTooThin,
  coreForSame,
  trigramSimilarity
} from "@/lib/luna-admin/link-parse";

export type RejudgeSameReport = {
  scanned: number;
  skipped_human: number;
  skipped_rejected: number;
  demoted: number;
  kept: number;
  too_thin: number;
};

export async function rejudgeAutoSame(
  admin: SupabaseClient,
  log: (msg: string) => void = console.log
): Promise<RejudgeSameReport> {
  const report: RejudgeSameReport = {
    scanned: 0,
    skipped_human: 0,
    skipped_rejected: 0,
    demoted: 0,
    kept: 0,
    too_thin: 0
  };

  const rows: Array<{
    id: string;
    source: string;
    status: string;
    confidence: number;
    evidence: Record<string, unknown> | null;
  }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("luna_links")
      .select("id, source, status, confidence, evidence")
      .eq("kind", "same")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`luna_links: ${error.message}`);
    const part = data ?? [];
    rows.push(...(part as typeof rows));
    if (part.length < 1000) break;
    from += 1000;
  }

  report.scanned = rows.length;
  const patches: Array<{
    id: string;
    evidence: Record<string, unknown>;
    status: string;
    confidence: number;
  }> = [];

  for (const row of rows) {
    if (row.source === "human") {
      report.skipped_human += 1;
      continue;
    }
    if (row.status === "rejected") {
      report.skipped_rejected += 1;
      continue;
    }
    const ev = { ...(row.evidence ?? {}) };
    const left = String(ev.from_title ?? "");
    const right = String(ev.to_title ?? "");
    const leftCore = coreForSame(left);
    const rightCore = coreForSame(right);
    const thin = sameCoreTooThin(leftCore) || sameCoreTooThin(rightCore);
    const sim = thin ? 0 : trigramSimilarity(left, right);
    const rounded = Math.round(sim * 1000) / 1000;
    const sameDate =
      Boolean(extractDateCode(left)) &&
      extractDateCode(left) === extractDateCode(right);
    ev.similarity = rounded;
    ev.same_date = sameDate;
    if (thin) ev.too_thin = true;
    else delete ev.too_thin;

    const demote = row.status === "active" && (thin || sim < LINK_AUTO_SAVE);
    if (demote) {
      if (thin) report.too_thin += 1;
      report.demoted += 1;
    } else {
      report.kept += 1;
    }
    patches.push({
      id: row.id,
      evidence: ev,
      status: demote ? "pending" : row.status,
      confidence: demote ? rounded : row.confidence
    });
  }

  for (const row of patches) {
    const { error } = await admin
      .from("luna_links")
      .update({
        evidence: row.evidence,
        status: row.status,
        confidence: row.confidence
      })
      .eq("id", row.id);
    if (error) throw new Error(`rejudge update: ${error.message}`);
  }

  log(
    `[rejudge-same] scanned=${report.scanned} human=${report.skipped_human} demoted=${report.demoted} kept=${report.kept} thin=${report.too_thin}`
  );
  return report;
}
