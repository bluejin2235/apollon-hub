/**
 * 추이 카드 한 문장 — 「늘었어요 / 줄었어요 / 비슷해요 / 기록 시작 전이에요」와 비교가 공정한지.
 *
 * 규칙
 *   · 앞 기간과 견줄 수 있으면(같은 길이 · 같은 기준) 두 합계를 견준다. 앞 기간 값이 있는 날끼리만 더한다.
 *   · 견줄 수 없으면 이유를 적고, 이번 기간 안에서 앞쪽 절반과 뒤쪽 절반을 견준다(4일 이상일 때만).
 *     며칠 묶음(days)이면 묶음 길이가 다를 수 있어 합이 아니라 하루 평균으로 견준다.
 *   · 차이가 작으면(2 이하이거나 10% 안쪽) 「비슷해요」.
 */

export type TrendTone = "up" | "down" | "flat" | "none";

export type TrendFact = {
  tone: TrendTone;
  text: string;
  fair: boolean;
  fairText: string;
};

function sum(list: (number | null)[]): number {
  return list.reduce<number>((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
}

function count(value: number, unit: string): string {
  return `${Math.round(value).toLocaleString("ko-KR")}${unit}`;
}

/** 차이가 작은가 — 2 이하이거나 앞 값의 10% 안쪽 */
export function isSmallChange(now: number, before: number): boolean {
  const diff = Math.abs(now - before);
  return diff <= 2 || (before > 0 && diff / before < 0.1);
}

export type TrendInput = {
  /** 문장 주어 — 「일반 명사 검색 노출」 */
  name: string;
  unit: string;
  current: (number | null)[];
  /** 같은 순번의 앞 기간 값. 견줄 수 없으면 null */
  previous: (number | null)[] | null;
  /** 앞 기간과 견줄 수 없는 이유(쉬운 말). 있으면 previous 는 보지 않는다 */
  unfairReason?: string | null;
  /** 아직 기록을 시작하기 전 기간이면 그 날짜 글 — 「11월 16일」 */
  startsOn?: string | null;
  /**
   * 값마다 품은 날 수(며칠 묶음일 때). 묶음 길이가 다르면 합끼리 견주면 안 되므로,
   * 기간 안 앞쪽 · 뒤쪽을 견줄 때 하루 평균으로 견준다. 없으면 모두 하루.
   */
  days?: number[];
};

function avgText(value: number, unit: string): string {
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
}

export function trendFact(input: TrendInput): TrendFact {
  const { name, unit, current, previous, unfairReason, startsOn } = input;
  const known = current.filter((v): v is number => typeof v === "number");
  if (known.length === 0) {
    if (startsOn) {
      return {
        tone: "none",
        text: `${name}: 기록 시작 전이에요. ${startsOn}부터 기록해요.`,
        fair: false,
        fairText: `${startsOn} 앞은 기록이 없어 견줄 수 없어요.`
      };
    }
    return { tone: "none", text: `${name}: 이 기간에는 기록이 없어요.`, fair: false, fairText: "기록이 없어 견줄 수 없어요." };
  }
  const now = sum(current);

  if (!unfairReason && previous && previous.some((v) => typeof v === "number")) {
    // 이번 값과 앞 값이 둘 다 있는 날끼리만 더한다 — 늦게 들어오는 자료로 날 수가 달라지지 않게
    let a = 0;
    let b = 0;
    current.forEach((v, i) => {
      const p = previous[i];
      if (typeof v === "number" && typeof p === "number") {
        a += v;
        b += p;
      }
    });
    const tone: TrendTone = isSmallChange(a, b) ? "flat" : a > b ? "up" : "down";
    const verb = tone === "flat" ? "앞 기간과 비슷해요" : tone === "up" ? "앞 기간보다 늘었어요" : "앞 기간보다 줄었어요";
    return {
      tone,
      text: `${name}: ${verb}. 이번 ${count(a, unit)} · 앞 기간 ${count(b, unit)}.`,
      fair: true,
      fairText: "같은 날 수끼리 견줬어요."
    };
  }

  const reason = unfairReason ?? "앞 기간 기록이 없어요.";
  const days = input.days;
  if (days && days.some((d) => d !== 1)) {
    // 며칠 묶음 — 묶음 길이가 달라도 공정하게 하루 평균으로 견준다
    const pairs = current
      .map((v, i) => (typeof v === "number" && (days[i] ?? 0) > 0 ? { v, d: days[i] } : null))
      .filter((p): p is { v: number; d: number } => p !== null);
    const allDays = pairs.reduce((acc, p) => acc + p.d, 0);
    if (pairs.length < 4) {
      return {
        tone: "none",
        text: `${name}: 이번 기간 ${count(now, unit)}. 기록한 묶음이 ${pairs.length}개(${allDays}일)뿐이라 늘었는지 줄었는지는 아직 몰라요.`,
        fair: false,
        fairText: reason
      };
    }
    const halfN = Math.floor(pairs.length / 2);
    const part = (list: { v: number; d: number }[]) => {
      const d = list.reduce((acc, p) => acc + p.d, 0);
      return { d, avg: list.reduce((acc, p) => acc + p.v, 0) / d };
    };
    const head = part(pairs.slice(0, halfN));
    const tail = part(pairs.slice(pairs.length - halfN));
    const diff = Math.abs(tail.avg - head.avg);
    // 작은 차이 — 하루 평균 차이를 짧은 쪽 날 수만큼 모아도 2 이하이거나 10% 안쪽
    const small = diff * Math.min(head.d, tail.d) <= 2 || (head.avg > 0 && diff / head.avg < 0.1);
    const tone: TrendTone = small ? "flat" : tail.avg > head.avg ? "up" : "down";
    const a = `기간 앞쪽 ${head.d}일(하루 평균 ${avgText(head.avg, unit)})`;
    const b = `뒤쪽 ${tail.d}일(하루 평균 ${avgText(tail.avg, unit)})`;
    return {
      tone,
      text: `${name}: 이번 기간 ${count(now, unit)}. ${
        tone === "flat" ? `${a}과 ${b}이 비슷해요` : `${a}보다 ${b}이 ${tone === "up" ? "늘었어요" : "줄었어요"}`
      }.`,
      fair: false,
      fairText: `${reason} 묶음 길이가 달라 하루 평균으로 견줬어요.`
    };
  }
  if (known.length < 4) {
    return {
      tone: "none",
      text: `${name}: 이번 기간 ${count(now, unit)}. 기록한 날이 ${known.length}일뿐이라 늘었는지 줄었는지는 아직 몰라요.`,
      fair: false,
      fairText: reason
    };
  }
  const half = Math.floor(known.length / 2);
  const first = sum(known.slice(0, half));
  const last = sum(known.slice(known.length - half));
  const tone: TrendTone = isSmallChange(last, first) ? "flat" : last > first ? "up" : "down";
  const halves =
    tone === "flat"
      ? `기간 앞쪽 ${half}일(${count(first, unit)})과 뒤쪽 ${half}일(${count(last, unit)})이 비슷해요`
      : `기간 앞쪽 ${half}일(${count(first, unit)})보다 뒤쪽 ${half}일(${count(last, unit)})이 ${tone === "up" ? "늘었어요" : "줄었어요"}`;
  return {
    tone,
    text: `${name}: 이번 기간 ${count(now, unit)}. ${halves}.`,
    fair: false,
    fairText: reason
  };
}
