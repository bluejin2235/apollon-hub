import type { ContractType, License, Profile } from "@/lib/licenses/types";

/** `useKrwRates()` 등에서 넘기는 USD/EUR→KRW 환율 (원화 정수/실수) */
export type LicenseFxRates = { USD?: number | null; EUR?: number | null } | null | undefined;

/**
 * 상세·목록·다음 결제일 계산에서 쓰는 계약 유형.
 * - 신규: `contract_type` 이 "월 구독" | "년 구독" | "영구 라이선스"
 * - 레거시: `contract_type` 비어 있고 `cost_type` 만 "월간" | "연간" | "영구" 인 행이 있음 → 동일 UI로 매핑
 */
export function resolveUiContractType(l: Pick<License, "contract_type" | "cost_type">): ContractType {
  const ct = (l.contract_type ?? "").trim();
  if (ct === "월 구독" || ct === "년 구독" || ct === "영구 라이선스") {
    return ct;
  }
  switch (l.cost_type) {
    case "월간":
      return "월 구독";
    case "연간":
      return "년 구독";
    case "영구":
      return "영구 라이선스";
    default:
      return "월 구독";
  }
}

/**
 * 상세 페이지 `cost` useMemo · 목록 카드 비용과 동일한 산출.
 * - KRW: `cost_monthly` 우선, 없으면 `cost`
 * - USD/EUR: `cost` 우선, 없으면 `cost_monthly`
 */
export function licenseCurrencyRawCost(l: Pick<License, "currency" | "cost" | "cost_monthly">): number {
  const currency = ((l.currency ?? "KRW") as string).toUpperCase();
  const isKrw = currency === "KRW";
  const costMonthlyNum = Number(l.cost_monthly ?? 0);
  const costNum = Number(l.cost ?? 0);
  if (isKrw) {
    return costMonthlyNum > 0 ? costMonthlyNum : costNum;
  }
  return costNum > 0 ? costNum : costMonthlyNum;
}

export type LicenseCostBreakdown = {
  currency: string;
  isKrw: boolean;
  uiContract: ContractType;
  isYearly: boolean;
  isPerpetual: boolean;
  isMonthly: boolean;
  rawCost: number;
  licenseCount: number;
  seatCount: number;
  perpetualPerUnitOrig: number;
  perpetualTotalOrig: number;
  perpetualPerUnitKrw: number | null;
  perpetualTotalKrw: number | null;
  monthlyTotalOrig: number;
  monthlyTotalKrw: number | null;
  annualTotalOrig: number;
  annualTotalKrw: number | null;
  perUnitMonthlyOrig: number;
  perUnitMonthlyKrw: number | null;
  fxRate: number | null;
  fxRateFormatted: string | null;
};

/**
 * 라이선스 상세·목록 공통 비용 모델 (원화/외화, 월·년·영구).
 */
export function computeLicenseCostBreakdown(
  license: Pick<
    License,
    | "currency"
    | "cost"
    | "cost_monthly"
    | "license_count"
    | "contract_type"
    | "cost_type"
  >,
  rates: LicenseFxRates
): LicenseCostBreakdown {
  const currency = ((license.currency ?? "KRW") as string).toUpperCase();
  const isKrw = currency === "KRW";
  const costMonthlyNum = Number(license.cost_monthly ?? 0);
  const costNum = Number(license.cost ?? 0);
  const rawCost = licenseCurrencyRawCost(license);
  const fxRate =
    currency === "USD" ? (rates?.USD ?? null) : currency === "EUR" ? (rates?.EUR ?? null) : null;

  const licenseCount = Math.max(1, license.license_count || 1);
  const uiContract = resolveUiContractType(license);
  const isYearly = uiContract === "년 구독";
  const isPerpetual = uiContract === "영구 라이선스";
  const isMonthly = uiContract === "월 구독";

  const seatCount = Math.max(0, license.license_count ?? 0);
  let perpetualPerUnitOrig: number;
  let perpetualTotalOrig: number;
  if (isPerpetual && seatCount > 0) {
    const cn = costNum;
    const cm = costMonthlyNum;
    const looksLikeTotalWithPerSeatMonthly =
      cn > 0 &&
      cm > 0 &&
      Math.abs(cn - cm * seatCount) < 0.01 &&
      Math.abs(cn - cm) > 0.01;
    if (looksLikeTotalWithPerSeatMonthly) {
      perpetualTotalOrig = cn;
      perpetualPerUnitOrig = cm;
    } else {
      perpetualPerUnitOrig = rawCost;
      perpetualTotalOrig = perpetualPerUnitOrig * seatCount;
    }
  } else {
    perpetualPerUnitOrig = rawCost;
    perpetualTotalOrig = seatCount > 0 ? perpetualPerUnitOrig * seatCount : perpetualPerUnitOrig;
  }
  const perpetualPerUnitKrw = isKrw
    ? perpetualPerUnitOrig
    : fxRate != null
      ? perpetualPerUnitOrig * fxRate
      : null;
  const perpetualTotalKrw =
    perpetualPerUnitKrw != null
      ? seatCount > 0
        ? perpetualPerUnitKrw * seatCount
        : perpetualPerUnitKrw
      : null;

  const monthlyTotalOrig = isPerpetual
    ? perpetualPerUnitOrig
    : isYearly
      ? (rawCost / 12) * licenseCount
      : rawCost * licenseCount;
  const monthlyTotalKrw = isPerpetual
    ? perpetualPerUnitKrw
    : isKrw
      ? monthlyTotalOrig
      : fxRate != null
        ? monthlyTotalOrig * fxRate
        : null;
  const annualTotalOrig = isPerpetual
    ? perpetualTotalOrig
    : isYearly
      ? rawCost * licenseCount
      : monthlyTotalOrig * 12;
  const annualTotalKrw = isPerpetual
    ? perpetualTotalKrw
    : isKrw
      ? annualTotalOrig
      : fxRate != null
        ? annualTotalOrig * fxRate
        : null;
  const perUnitMonthlyOrig = isPerpetual
    ? perpetualPerUnitOrig
    : isYearly
      ? rawCost / 12
      : rawCost;
  const perUnitMonthlyKrw =
    isPerpetual ? perpetualPerUnitKrw : monthlyTotalKrw != null ? monthlyTotalKrw / licenseCount : null;
  const fxRateFormatted = fxRate != null ? Math.round(fxRate).toLocaleString("ko-KR") : null;

  return {
    currency,
    isKrw,
    uiContract,
    isYearly,
    isPerpetual,
    isMonthly,
    rawCost,
    licenseCount,
    seatCount,
    perpetualPerUnitOrig,
    perpetualTotalOrig,
    perpetualPerUnitKrw,
    perpetualTotalKrw,
    monthlyTotalOrig,
    monthlyTotalKrw,
    annualTotalOrig,
    annualTotalKrw,
    perUnitMonthlyOrig,
    perUnitMonthlyKrw,
    fxRate,
    fxRateFormatted
  };
}

/** 목록 카드 pill: DB `cost_type` 스타일 라벨 */
export function licenseListCostBadgeLabel(ui: ContractType): string {
  if (ui === "영구 라이선스") return "영구 라이선스";
  if (ui === "년 구독") return "연간";
  return "월간";
}

/** 목록·상세 가격 접미사 (/월, /년) */
export function licenseCostSuffix(ui: ContractType): string {
  if (ui === "월 구독") return "/월";
  if (ui === "년 구독") return "/년";
  return "";
}

/** 비용 높은순 정렬용 단일 스칼라 (KRW 우선, 없으면 원본 월간 상당) */
export function licenseCostSortValue(license: License, rates: LicenseFxRates): number {
  const b = computeLicenseCostBreakdown(license, rates);
  if (b.isPerpetual) return b.perpetualTotalKrw ?? b.perpetualTotalOrig;
  if (b.isYearly) return b.annualTotalKrw ?? b.annualTotalOrig;
  return b.monthlyTotalKrw ?? b.monthlyTotalOrig;
}

/**
 * 목록 카드 첫 줄 금액 (원화 표시 숫자). 외화일 때 KRW 환산값.
 * - 영구: 총 구매
 * - 월: 전체 월 합산
 * - 년: 연간 총액 (좌석당 연간 × 수량)
 */
export function licenseListCardPrimaryKrwAmount(b: LicenseCostBreakdown): number | null {
  if (b.isPerpetual) return b.perpetualTotalKrw;
  if (b.isYearly) return b.annualTotalKrw;
  return b.monthlyTotalKrw;
}

/** 목록 카드 첫 줄 원본 통화 금액 (외화 큰 숫자용) */
export function licenseListCardPrimaryOrigAmount(b: LicenseCostBreakdown): number {
  if (b.isPerpetual) return b.perpetualTotalOrig;
  if (b.isYearly) return b.annualTotalOrig;
  return b.monthlyTotalOrig;
}

/**
 * 상세·목록 카드 보조 한 줄 (HTML 아님, 포맷은 호출측).
 * - 영구·수량≥2: 개당×개수
 * - 월: 개당/월 × 수량
 * - 년: 개당 연 /년 × 수량 (rawCost = 좌석당 연간)
 */
export function licenseListCardCostSublineParts(b: LicenseCostBreakdown): {
  show: boolean;
  /** 원화일 때 각각 formatCurrency 로 이어붙이기 */
  krwPerPart: number | null;
  krwCount: number | null;
  /** 외화: perUnit 원본 + 개수 */
  origPerPart: number | null;
  origCount: number | null;
  suffix: "/월" | "/년" | null;
} {
  if (b.isPerpetual) {
    if (b.licenseCount < 2) {
      return { show: false, krwPerPart: null, krwCount: null, origPerPart: null, origCount: null, suffix: null };
    }
    return {
      show: true,
      krwPerPart: b.perpetualPerUnitKrw,
      krwCount: b.seatCount,
      origPerPart: b.perpetualPerUnitOrig,
      origCount: b.seatCount,
      suffix: null
    };
  }
  if (b.isMonthly) {
    return {
      show: true,
      krwPerPart: b.isKrw ? b.perUnitMonthlyOrig : b.perUnitMonthlyKrw,
      krwCount: b.licenseCount,
      origPerPart: b.perUnitMonthlyOrig,
      origCount: b.licenseCount,
      suffix: "/월"
    };
  }
  // 년 구독: 좌석당 연간(rawCost) × 수량
  const krwAnnualPerSeat =
    b.isKrw ? b.rawCost : b.fxRate != null ? b.rawCost * b.fxRate : null;
  return {
    show: true,
    krwPerPart: krwAnnualPerSeat,
    krwCount: b.licenseCount,
    origPerPart: b.rawCost,
    origCount: b.licenseCount,
    suffix: "/년"
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(
    value
  );
}

export function formatDateKorean(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR");
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(`${iso}T12:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const ms = target - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function isSubscription(l: Pick<License, "contract_type" | "cost_type">): boolean {
  const ui = resolveUiContractType(l);
  return ui === "월 구독" || ui === "년 구독";
}

export function activeProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.status === "근무");
}

export function aggregateByCategory(licenses: License[]): Record<string, number> {
  const m: Record<string, number> = {};
  licenses.forEach((l) => {
    m[l.category] = (m[l.category] ?? 0) + l.license_count;
  });
  return m;
}

export const categoryChartColors: Record<string, string> = {
  기본: "#4f76ff",
  SaaS: "#7c9dff",
  인프라: "#3558db",
  기타: "#a9c3ff"
};

/**
 * payment_day / payment_month 를 기반으로 오늘 이후 가장 가까운 결제일을 계산.
 * - 월 구독: payment_day 만 사용. 이번 달 해당일이 오늘 이후면 그날, 아니면 다음 달.
 * - 년 구독: payment_month + payment_day. 올해 해당일이 오늘 이후면 올해, 아니면 내년.
 * - 영구 라이선스 / 데이터 부족 시 null.
 * 월 마지막 날 보정(예: 2월 30일 → 2월 말일)도 수행한다.
 */
export function computeNextPayment(
  contractType: string | null | undefined,
  paymentDay: number | null | undefined,
  paymentMonth: number | null | undefined,
  reference: Date = new Date()
): Date | null {
  if (paymentDay == null || paymentDay < 1 || paymentDay > 31) return null;

  const today = new Date(reference);
  today.setHours(12, 0, 0, 0);

  const buildDate = (year: number, month0: number, day: number): Date => {
    // Date 생성자는 day overflow 시 다음 달로 넘어가므로 같은 달 보장을 위해 보정
    const candidate = new Date(year, month0, day, 12, 0, 0, 0);
    if (candidate.getMonth() !== ((month0 % 12) + 12) % 12) {
      // overflow → 의도한 달의 말일로 클램프
      return new Date(year, month0 + 1, 0, 12, 0, 0, 0);
    }
    return candidate;
  };

  if (contractType === "월 구독") {
    const thisMonth = buildDate(today.getFullYear(), today.getMonth(), paymentDay);
    if (thisMonth.getTime() >= today.getTime()) return thisMonth;
    return buildDate(today.getFullYear(), today.getMonth() + 1, paymentDay);
  }

  if (contractType === "년 구독") {
    if (paymentMonth == null || paymentMonth < 1 || paymentMonth > 12) return null;
    const thisYear = buildDate(today.getFullYear(), paymentMonth - 1, paymentDay);
    if (thisYear.getTime() >= today.getTime()) return thisYear;
    return buildDate(today.getFullYear() + 1, paymentMonth - 1, paymentDay);
  }

  return null;
}

/**
 * `end_date`(갱신일) 월·일을 매년 반복하는 앵커로 보고, 오늘 이후 가장 가까운 날짜.
 */
export function nextOccurrenceFromAnnualEndDate(
  endDateIso: string | null | undefined,
  reference: Date = new Date()
): Date | null {
  if (!endDateIso || endDateIso.length < 10) return null;
  const anchor = new Date(`${endDateIso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;
  const today = new Date(reference);
  today.setHours(12, 0, 0, 0);
  let d = new Date(anchor);
  for (let i = 0; i < 80; i++) {
    if (d.getTime() >= today.getTime()) return d;
    d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }
  return null;
}

/** 목록·상세·대시보드 공통: 다음 갱신/결제일 */
export function computeLicenseNextRenewal(
  l: Pick<License, "contract_type" | "cost_type" | "payment_day" | "payment_month" | "end_date">,
  reference: Date = new Date()
): Date | null {
  const ui = resolveUiContractType(l);
  if (ui === "년 구독" && l.end_date) {
    const fromEnd = nextOccurrenceFromAnnualEndDate(l.end_date, reference);
    if (fromEnd) return fromEnd;
  }
  return computeNextPayment(ui, l.payment_day, l.payment_month, reference);
}

/** Date → 'YYYY-MM-DD' (로컬 기준). 다른 ISO 변환과 안전하게 비교하기 위함. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextRenewalDate(licenses: License[]): string | null {
  const dates: string[] = [];
  for (const l of licenses) {
    const computed = computeLicenseNextRenewal(l);
    if (computed) {
      dates.push(toIsoDate(computed));
      continue;
    }
    if (l.next_renewal) dates.push(l.next_renewal);
  }
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

export function totalActiveSubscriptionMonthly(licenses: License[]): number {
  return licenses.filter((l) => isSubscription(l)).reduce((s, l) => s + Number(l.cost_monthly || 0), 0);
}

export function totalPerpetualPurchase(licenses: License[]): number {
  return licenses
    .filter((l) => resolveUiContractType(l) === "영구 라이선스")
    .reduce((s, l) => s + Number(l.cost_monthly || 0), 0);
}
