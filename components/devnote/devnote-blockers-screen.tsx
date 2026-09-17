"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DevnoteStatusDot } from "@/components/devnote/devnote-status-dot";
import { DevnoteButton, DevnoteError } from "@/components/devnote/devnote-ui";
import {
  loadDevnoteBlockers,
  setDevnoteBlockerResolved,
  type DevnoteBlockerRow
} from "@/lib/devnote/blockers";
import { supabase } from "@/lib/supabase/client";

function kstTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/** since 날짜부터 오늘까지 며칠째인지 (당일=1). */
function daysSince(since: string | null, today = kstTodayYmd()): number | null {
  if (!since) return null;
  const start = Date.parse(`${since}T00:00:00+09:00`);
  const end = Date.parse(`${today}T00:00:00+09:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = Math.floor((end - start) / 86_400_000) + 1;
  return days < 1 ? 1 : days;
}

function groupByService(rows: DevnoteBlockerRow[]) {
  const groups = new Map<string, DevnoteBlockerRow[]>();
  for (const row of rows) {
    const list = groups.get(row.service_name);
    if (list) list.push(row);
    else groups.set(row.service_name, [row]);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

function BlockerCard({
  row,
  faded,
  busy,
  onToggle
}: {
  row: DevnoteBlockerRow;
  faded?: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const days = daysSince(row.since);
  return (
    <li
      className={`rounded-[10px] border border-[#E2E5EA] bg-white px-4 py-3 ${
        faded ? "opacity-45" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#15171C]">{row.title}</p>
          {row.body ? (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#4A505C]">
              {row.body}
            </p>
          ) : null}
          <p className="mt-1.5 font-mono text-[11.5px] text-[#858C9A]">
            {row.service_slug ? (
              <Link
                href={`/devnote/s/${row.service_slug}`}
                className="hover:underline"
              >
                {row.service_name}
              </Link>
            ) : (
              row.service_name
            )}
            {days != null ? ` · ${days}일째` : ""}
            {row.since ? ` · ${row.since}부터` : ""}
            {row.resolved_at ? ` · ${row.resolved_at} 해결` : ""}
          </p>
        </div>
        <DevnoteButton disabled={busy} onClick={onToggle}>
          {busy ? "…" : row.resolved_at ? "다시 열기" : "해결됨"}
        </DevnoteButton>
      </div>
    </li>
  );
}

export function DevnoteBlockersScreen() {
  const [rows, setRows] = useState<DevnoteBlockerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadDevnoteBlockers(supabase)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(() => rows.filter((r) => !r.resolved_at), [rows]);
  const resolved = useMemo(() => rows.filter((r) => r.resolved_at), [rows]);
  const openGroups = useMemo(() => groupByService(open), [open]);

  async function toggle(row: DevnoteBlockerRow) {
    if (busyId) return;
    setBusyId(row.id);
    setError(null);
    try {
      const resolvedAt = await setDevnoteBlockerResolved(
        supabase,
        row.id,
        !row.resolved_at
      );
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, resolved_at: resolvedAt } : r))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <p className="mb-2.5 text-xs text-[#858C9A]">개발노트</p>
      <h1 className="text-[26px] font-bold tracking-tight text-[#15171C]">
        막힌 것
      </h1>
      <p className="mt-2 text-xs text-[#858C9A]">
        풀리지 않은 것을 모읍니다. 아침 리포트가 여기서 단서를 가져갑니다.
        {open.length > 0 ? ` · 안 풀린 것 ${open.length}` : ""}
      </p>

      {error ? <div className="mt-6"><DevnoteError message={error} /></div> : null}

      {loading ? (
        <p className="mt-6 text-sm text-[#858C9A]">불러오는 중…</p>
      ) : open.length === 0 && resolved.length === 0 ? (
        <div className="mt-6 rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
          <p className="text-[13px] text-[#858C9A]">막힌 것이 없습니다.</p>
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-7">
          {open.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-[#E2E5EA] px-6 py-8 text-center">
              <p className="text-[13px] text-[#858C9A]">안 풀린 것이 없습니다.</p>
            </div>
          ) : (
            openGroups.map(([serviceName, items]) => (
              <section key={serviceName}>
                <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-[#15171C]">
                  <DevnoteStatusDot
                    status={items[0]!.service_status ?? "plain"}
                  />
                  {items[0]!.service_slug ? (
                    <Link
                      href={`/devnote/s/${items[0]!.service_slug}`}
                      className="hover:underline"
                    >
                      {serviceName}
                    </Link>
                  ) : (
                    serviceName
                  )}
                  <span className="font-normal tabular-nums text-[11px] text-[#858C9A]">
                    {items.length}
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((row) => (
                    <BlockerCard
                      key={row.id}
                      row={row}
                      busy={busyId === row.id}
                      onToggle={() => void toggle(row)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {resolved.length > 0 ? (
            <section className="border-t border-[#E2E5EA] pt-7">
              <h2 className="mb-2.5 text-[13px] font-semibold text-[#858C9A]">
                해결됨
                <span className="ml-2 font-normal tabular-nums text-[11px]">
                  {resolved.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-2">
                {resolved.map((row) => (
                  <BlockerCard
                    key={row.id}
                    row={row}
                    faded
                    busy={busyId === row.id}
                    onToggle={() => void toggle(row)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
