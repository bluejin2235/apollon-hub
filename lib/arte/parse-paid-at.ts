import { kstIsoDate } from "@/lib/fx/dates";

export type PaidAtSuspicious = "future" | "too_old" | "year_mismatch" | null;

export type NormalizedPaidAt = {
  iso: string;
  yearMissing: boolean;
  twoDigitYear: boolean;
  suspicious: PaidAtSuspicious;
};

const MONTH_NAME: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const MONTH_NAME_RE =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function twoYearsAgo(today: string): string {
  const [ty, tm, td] = today.split("-").map(Number);
  const year = ty - 2;
  const iso = validYmd(year, tm, td);
  if (iso) return iso;
  const last = new Date(Date.UTC(year, tm, 0)).getUTCDate();
  return validYmd(year, tm, Math.min(td, last)) ?? `${year}-${pad2(tm)}-${pad2(last)}`;
}

export function isPaidAtSuspicious(iso: string, today = kstIsoDate()): PaidAtSuspicious {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const sameMonthDay = iso.slice(5) === today.slice(5);
  const differentYear = iso.slice(0, 4) !== today.slice(0, 4);
  // 월·일이 오늘과 같고 연도만 다름 — OCR이 학습 컷오프 연도를 넣은 실제 사례
  if (sameMonthDay && differentYear) return "year_mismatch";
  if (iso > today) return "future";
  if (iso <= twoYearsAgo(today)) return "too_old";
  return null;
}

export function paidAtSuspiciousConfirmMessage(iso: string, kind: PaidAtSuspicious): string | null {
  if (!kind) return null;
  if (kind === "year_mismatch") {
    return `결제일이 ${iso}로 인식되었습니다. 연도가 맞습니까?`;
  }
  return `결제일이 ${iso}로 인식되었습니다. 맞습니까?`;
}

function expandTwoDigitYear(yy: number, month: number, day: number, today: string): number {
  const year20 = 2000 + yy;
  const iso20 = validYmd(year20, month, day);
  if (iso20 && iso20 > today) return Number(today.slice(0, 4));
  return year20;
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  yearMissing: boolean;
  twoDigitYear: boolean;
};

function fromYmd(
  year: number,
  month: number,
  day: number,
  flags: { yearMissing?: boolean; twoDigitYear?: boolean }
): DateParts | null {
  if (!validYmd(year, month, day)) return null;
  return {
    year,
    month,
    day,
    yearMissing: flags.yearMissing === true,
    twoDigitYear: flags.twoDigitYear === true
  };
}

function resolveYear(rawYear: number, month: number, day: number, today: string): DateParts | null {
  if (rawYear >= 100) {
    return fromYmd(rawYear, month, day, { twoDigitYear: false });
  }
  const year = expandTwoDigitYear(rawYear, month, day, today);
  return fromYmd(year, month, day, { twoDigitYear: true });
}

/** 월·일만 있고 연도가 없으면 현재 연도. MM/DD vs DD/MM 은 미국 영수증(MM/DD) 우선. */
function resolveMonthDayYear(
  a: number,
  b: number,
  rawYear: number | null,
  today: string
): DateParts | null {
  const todayYear = Number(today.slice(0, 4));
  const withYear = (month: number, day: number, year: number, twoDigitYear: boolean, yearMissing: boolean) =>
    fromYmd(year, month, day, { twoDigitYear, yearMissing });

  const applyYear = (month: number, day: number): DateParts | null => {
    if (rawYear == null) return withYear(month, day, todayYear, false, true);
    return resolveYear(rawYear, month, day, today);
  };

  if (a > 12 && b >= 1 && b <= 12) return applyYear(b, a);
  if (b > 12 && a >= 1 && a <= 12) return applyYear(a, b);
  if (a >= 1 && a <= 12) return applyYear(a, b);
  return null;
}

function parseMonthName(token: string): number | null {
  return MONTH_NAME[token.toLowerCase()] ?? null;
}

function parseDateParts(raw: string, today: string): DateParts | null {
  const s = raw.trim().replace(/[，]/g, ",").replace(/\s+/g, " ");
  if (!s) return null;

  const isoPrefix = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoPrefix) {
    return fromYmd(Number(isoPrefix[1]), Number(isoPrefix[2]), Number(isoPrefix[3]), {});
  }

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return fromYmd(Number(compact[1]), Number(compact[2]), Number(compact[3]), {});
  }

  const koreanFull = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (koreanFull) {
    return fromYmd(Number(koreanFull[1]), Number(koreanFull[2]), Number(koreanFull[3]), {});
  }

  const koreanNoYear = s.match(/(?:^|[^\d])(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (koreanNoYear && !/\d{4}\s*년/.test(s)) {
    return resolveMonthDayYear(Number(koreanNoYear[1]), Number(koreanNoYear[2]), null, today);
  }

  const monthFirst = s.match(
    new RegExp(`^(${MONTH_NAME_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?$`, "i")
  );
  if (monthFirst) {
    const month = parseMonthName(monthFirst[1]);
    if (month) {
      const day = Number(monthFirst[2]);
      if (monthFirst[3]) return resolveYear(Number(monthFirst[3]), month, day, today);
      return fromYmd(Number(today.slice(0, 4)), month, day, { yearMissing: true });
    }
  }

  const dayMonth = s.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_RE})\\.?(?:,?\\s+(\\d{2,4}))?$`, "i")
  );
  if (dayMonth) {
    const month = parseMonthName(dayMonth[2]);
    if (month) {
      const day = Number(dayMonth[1]);
      if (dayMonth[3]) return resolveYear(Number(dayMonth[3]), month, day, today);
      return fromYmd(Number(today.slice(0, 4)), month, day, { yearMissing: true });
    }
  }

  const numeric = s.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);
  if (numeric) {
    const n1 = Number(numeric[1]);
    const n2 = Number(numeric[2]);
    const n3 = Number(numeric[3]);
    if (numeric[1].length === 4) {
      return fromYmd(n1, n2, n3, {});
    }
    if (numeric[3].length === 4) {
      return resolveMonthDayYear(n1, n2, n3, today);
    }
    if (numeric[3].length === 2) {
      if (numeric[1].length === 2 && n1 > 12 && n2 >= 1 && n2 <= 12) {
        return resolveYear(n1, n2, n3, today);
      }
      return resolveMonthDayYear(n1, n2, n3, today);
    }
  }

  const twoPart = s.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (twoPart) {
    return resolveMonthDayYear(Number(twoPart[1]), Number(twoPart[2]), null, today);
  }

  return null;
}

/** OCR·폼에서 온 결제일 문자열을 YYYY-MM-DD 로. 실패·빈 값이면 오늘(KST). */
export function normalizePaidAt(raw: string | null | undefined, today = kstIsoDate()): NormalizedPaidAt {
  const fallback: NormalizedPaidAt = {
    iso: today,
    yearMissing: true,
    twoDigitYear: false,
    suspicious: isPaidAtSuspicious(today, today)
  };
  if (raw == null) return fallback;
  const parsed = parseDateParts(String(raw), today);
  if (!parsed) return fallback;
  const iso = validYmd(parsed.year, parsed.month, parsed.day);
  if (!iso) return fallback;
  return {
    iso,
    yearMissing: parsed.yearMissing,
    twoDigitYear: parsed.twoDigitYear,
    suspicious: isPaidAtSuspicious(iso, today)
  };
}
