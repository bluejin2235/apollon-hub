"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { listWorks } from "@/lib/website/api";
import { summarizeChecks, type HealthIssue } from "@/lib/website/checks";
import type { WorkListItem } from "@/lib/website/types";

export function WebsiteDashboard({ siteUrl }: { siteUrl: string }) {
  const [items, setItems] = useState<WorkListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listWorks({ status: "all", limit: 100 });
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error + (result.details ? ` · ${JSON.stringify(result.details)}` : ""));
        setLoading(false);
        return;
      }
      setItems(result.data.items ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => summarizeChecks(items), [items]);
  const healthy = stats.problem === 0 && stats.warn === 0;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
          대시보드
        </h1>
        {siteUrl ? (
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            홈페이지 열기 ↗
          </a>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error ? (
        <>
          <section className="apollon-card p-4">
            <p className="mb-3 text-xs font-medium tracking-wider text-slate-500">콘텐츠 현황</p>
            <div className="flex flex-wrap gap-x-8 gap-y-2" style={{ fontSize: "var(--fs-body)" }}>
              <span>
                <b className="text-slate-900">{items.length}</b> 워크{" "}
                <span className="text-slate-500">
                  공개 {stats.published} · 초안 {stats.draft}
                </span>
              </span>
              <span>
                <b className="text-slate-900">{stats.images}</b> 이미지
              </span>
              <span>
                <b className="text-slate-900">{stats.captions}</b> 캡션
              </span>
            </div>
          </section>

          <section className="apollon-card p-5">
            <div className="flex items-start gap-4">
              <div
                className={`grid h-16 w-16 shrink-0 place-items-center rounded-full text-2xl font-bold text-white ${
                  healthy ? "bg-emerald-500" : "bg-amber-500"
                }`}
              >
                {healthy ? "✓" : "!"}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900" style={{ fontSize: "var(--fs-section)" }}>
                  {healthy ? "사이트가 정상입니다" : "손볼 것이 있습니다"}
                </p>
                <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-sub)" }}>
                  공개에 지장을 주는 것 {stats.problem}건, 검색·AI 노출에 영향을 주는 것 {stats.warn}건
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <HealthTier label="문제" count={stats.problem} tone="problem" />
              <HealthTier label="확인 필요" count={stats.warn} tone="warn" />
              <HealthTier label="통과" count={stats.pass} tone="ok" />
            </div>

            {stats.issues.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {stats.issues.map((issue) => (
                  <IssueRow key={`${issue.workId}-${issue.flag}`} issue={issue} />
                ))}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function HealthTier({
  label,
  count,
  tone
}: {
  label: string;
  count: number;
  tone: "problem" | "warn" | "ok";
}) {
  const color =
    tone === "problem" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-emerald-600";
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3 text-center">
      <div className={`text-2xl font-semibold ${color}`}>{count}</div>
      <div className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
        {label}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: HealthIssue }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          issue.kind === "problem" ? "bg-rose-500" : "bg-amber-500"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{issue.label}</p>
        <p className="truncate text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
          워크 「{issue.title}」
        </p>
      </div>
      <Link
        href={`/website/works/${issue.workId}`}
        className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {issue.kind === "problem" ? "고치기" : "확인"}
      </Link>
    </li>
  );
}
