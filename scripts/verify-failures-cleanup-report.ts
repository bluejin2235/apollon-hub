/**
 * 실패 수집 정리 검증 (DB 읽기만)
 * npx tsx scripts/verify-failures-cleanup-report.ts
 */
import { config } from "dotenv";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import {
  isInspectFailure,
  isLikelyClarifyPickQuestion,
  matchesKindFilter,
  mergeFailureRowsByMessage,
  summarizeFailureKinds,
  type FailureKind,
  type FailureSignal
} from "../lib/luna/failures-shared";

type Row = {
  id: string;
  message_id: string | null;
  question: string;
  answer_excerpt: string;
  kind: FailureKind;
  signal: FailureSignal;
  signals?: FailureSignal[];
  intent_score: number | null;
  confidence_score: number | null;
  self_note: string | null;
  human_note?: string | null;
  asked_by: string | null;
  asked_by_name?: string | null;
  source_ref: Record<string, unknown>;
  created_at: string;
  verdict: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("env missing");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, count, error } = await admin
    .from("luna_failures")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const raw = (data ?? []) as Row[];
  const userIds = [...new Set(raw.map((r) => r.asked_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      if (p.id && p.name) names.set(p.id as string, p.name as string);
    }
  }

  const enriched = raw.map((r) => {
    const ref =
      r.source_ref && typeof r.source_ref === "object" ? r.source_ref : {};
    const humanNote =
      typeof (ref as { feedback_note?: string }).feedback_note === "string"
        ? (ref as { feedback_note: string }).feedback_note.trim()
        : "";
    let selfNote = r.self_note;
    if (
      !selfNote?.trim() &&
      typeof (ref as { reason?: string }).reason === "string"
    ) {
      selfNote = (ref as { reason: string }).reason.trim();
    }
    return {
      ...r,
      signals:
        Array.isArray(r.signals) && r.signals.length > 0
          ? r.signals
          : [r.signal],
      self_note: selfNote,
      human_note: humanNote || null,
      asked_by_name: r.asked_by ? names.get(r.asked_by) ?? null : null
    };
  });

  const merged = mergeFailureRowsByMessage(enriched).filter(
    (r) => isInspectFailure(r) || !isLikelyClarifyPickQuestion(r.question)
  );
  const summary = summarizeFailureKinds(merged);
  const allView = merged.filter((r) => matchesKindFilter(r, "all"));
  const inspectView = merged.filter((r) => matchesKindFilter(r, "inspect"));
  const nam = allView.filter((r) => (r.asked_by_name ?? "").includes("남은빈"));
  const clarifyHidden = enriched.filter((r) =>
    isLikelyClarifyPickQuestion(r.question)
  ).length;
  const withNote = allView.filter((r) => (r.self_note ?? "").trim());

  const lines = [
    "# 실패 수집 정리 검증",
    "",
    `DB raw: **${count ?? raw.length}**`,
    `병합+필터 후: **${merged.length}**`,
    `전체 탭: **${allView.length}** · 정기 점검 탭: **${inspectView.length}**`,
    "",
    `kind_summary: all=${summary.all} human=${summary.human} self=${summary.self} auto=${summary.auto} inspect=${summary.inspect}`,
    "",
    `## 남은빈 → ${nam.length}건 (기대 3)`,
    ...nam.map(
      (r) =>
        `- [${(r.signals ?? []).join("+")}] ${r.question.slice(0, 48)} · 🌙 ${(r.self_note ?? "").slice(0, 60)}`
    ),
    "",
    `되묻기 선택지 가림(DB유지): ${clarifyHidden}건`,
    `전체 탭 self_note 표시 가능: ${withNote.length}/${allView.length}`,
    "",
    "## 자동감지 중 사유 있는 샘플",
    ...allView
      .filter((r) => r.kind === "auto" && r.self_note)
      .slice(0, 5)
      .map((r) => `- ${r.question.slice(0, 36)} → ${r.self_note!.slice(0, 70)}`)
  ];

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "failures-cleanup-verify.md");
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log("\nWrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
