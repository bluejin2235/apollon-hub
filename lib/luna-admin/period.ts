export type PeriodKey = "today" | "yesterday" | "7" | "30" | "all" | "custom";

export type ResolvedPeriod = {
  key: PeriodKey;
  startIso: string | null;
  endIso: string | null;
  from_label: string;
  to_label: string;
};

const KEYS: PeriodKey[] = ["today", "yesterday", "7", "30", "all", "custom"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function kstParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes()
  };
}

function kstDayStart(d: Date): { startIso: string; endIso: string } {
  const p = kstParts(d);
  const startUtc = Date.UTC(p.year, p.month - 1, p.day) - 9 * 60 * 60 * 1000;
  return {
    startIso: new Date(startUtc).toISOString(),
    endIso: new Date(startUtc + 86_400_000).toISOString()
  };
}

export function kstDateString(d = new Date()): string {
  const p = kstParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function kstDateBounds(ymd: string): { startIso: string; endIso: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const y = m ? Number(m[1]) : 2026;
  const mo = m ? Number(m[2]) : 1;
  const d = m ? Number(m[3]) : 1;
  const startUtc = Date.UTC(y, mo - 1, d) - 9 * 60 * 60 * 1000;
  return {
    startIso: new Date(startUtc).toISOString(),
    endIso: new Date(startUtc + 86_400_000).toISOString()
  };
}

export function formatKstShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  return `${pad(p.month)}.${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatKstDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = kstParts(d);
  return `${p.year}.${pad(p.month)}.${pad(p.day)}`;
}

export function isPeriodKey(value: string | null): value is PeriodKey {
  return !!value && (KEYS as string[]).includes(value);
}

export function resolvePeriod(
  raw: string | null,
  fromYmd: string | null,
  toYmd: string | null
): ResolvedPeriod {
  const key: PeriodKey = isPeriodKey(raw) ? raw : "all";
  const today = kstDayStart(new Date());
  const yesterday = kstDayStart(new Date(Date.now() - 86_400_000));

  if (key === "all") {
    return { key, startIso: null, endIso: null, from_label: "", to_label: "" };
  }
  if (key === "today") {
    return {
      key,
      startIso: today.startIso,
      endIso: today.endIso,
      from_label: formatKstDate(today.startIso),
      to_label: formatKstDate(today.startIso)
    };
  }
  if (key === "yesterday") {
    return {
      key,
      startIso: yesterday.startIso,
      endIso: yesterday.endIso,
      from_label: formatKstDate(yesterday.startIso),
      to_label: formatKstDate(yesterday.startIso)
    };
  }
  if (key === "7" || key === "30") {
    const days = key === "7" ? 6 : 29;
    const start = kstDayStart(new Date(Date.now() - days * 86_400_000));
    return {
      key,
      startIso: start.startIso,
      endIso: today.endIso,
      from_label: formatKstDate(start.startIso),
      to_label: formatKstDate(today.startIso)
    };
  }
  const from = fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd) ? fromYmd : kstDateString();
  const to = toYmd && /^\d{4}-\d{2}-\d{2}$/.test(toYmd) ? toYmd : from;
  const a = kstDateBounds(from);
  const b = kstDateBounds(to);
  const startIso = a.startIso <= b.startIso ? a.startIso : b.startIso;
  const endIso = a.endIso >= b.endIso ? a.endIso : b.endIso;
  return {
    key: "custom",
    startIso,
    endIso,
    from_label: formatKstDate(startIso),
    to_label: formatKstDate(new Date(new Date(endIso).getTime() - 1000).toISOString())
  };
}

export function applyPeriod<T>(
  q: T,
  column: string,
  period: ResolvedPeriod
): T {
  if (!period.startIso) return q;
  const query = q as {
    gte: (c: string, v: string) => T;
    lt: (c: string, v: string) => T;
  };
  let out = query.gte(column, period.startIso);
  if (period.endIso) out = (out as typeof query).lt(column, period.endIso);
  return out;
}
