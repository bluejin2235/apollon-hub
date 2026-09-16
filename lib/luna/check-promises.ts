/**
 * luna_checks 약속 문구 — vercel cron(UTC) · 로컬 스케줄러 · schedule.ts 기준.
 * 검사 시 이 값이 DB promise_label 과 다르면 시드를 갱신한다.
 */
import {
  ADMIN_IMAGE_INDEX_HOUR,
  ADMIN_IMAGE_INDEX_MINUTE,
  ADMIN_LINKS_HOUR,
  ADMIN_LINKS_MINUTE,
  ADMIN_REPORT_HOUR,
  ADMIN_REPORT_MINUTE,
  ADMIN_SELFSTUDY_HOUR,
  ADMIN_SELFSTUDY_MINUTE,
  ADMIN_SIGNALS_HOUR,
  ADMIN_SIGNALS_MINUTE,
  ADMIN_WORK_INDEX_HOUR,
  ADMIN_WORK_INDEX_MINUTE
} from "@/lib/luna-admin/schedule";
import {
  CRON_CONSOLIDATE_HOUR,
  CRON_CONSOLIDATE_MINUTE,
  CRON_EVAL_LIGHT_HOUR,
  CRON_EVAL_LIGHT_MINUTE
} from "@/lib/luna/cron-times";

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** id → 약속 한 줄 · 근거 */
export const LUNA_CHECK_PROMISES: Record<
  string,
  { promise_label: string; source: string }
> = {
  model_market: {
    promise_label: "주 1회 약속",
    source: "luna-model-inspect cron */10 + weekly 설정"
  },
  work_index: {
    promise_label: `매일 ${hhmm(ADMIN_WORK_INDEX_HOUR, ADMIN_WORK_INDEX_MINUTE)} 약속`,
    source: "작업 스케줄러 LUNA NAS Scan + schedule.ts"
  },
  notion_index: {
    promise_label: "매일 03:20·13:30 약속",
    source: "notion_index_schedule 기본값 (vercel notion-index */10이 슬롯 실행)"
  },
  image_index: {
    promise_label: `매일 ${hhmm(ADMIN_IMAGE_INDEX_HOUR, ADMIN_IMAGE_INDEX_MINUTE)} 약속`,
    source: "작업 스케줄러 LUNA Media Index + schedule.ts"
  },
  links: {
    promise_label: `매일 ${hhmm(ADMIN_LINKS_HOUR, ADMIN_LINKS_MINUTE)} 약속`,
    source: "vercel luna-links 30 19 * * * → KST 04:30"
  },
  selfstudy: {
    promise_label: `매일 ${hhmm(ADMIN_SELFSTUDY_HOUR, ADMIN_SELFSTUDY_MINUTE)} 약속`,
    source: "vercel luna-selfstudy 0 20 * * * → KST 05:00"
  },
  signals: {
    promise_label: `매일 ${hhmm(ADMIN_SIGNALS_HOUR, ADMIN_SIGNALS_MINUTE)} 약속`,
    source: "vercel luna-signals 30 20 * * * → KST 05:30"
  },
  admin_report: {
    promise_label: `매일 ${hhmm(ADMIN_REPORT_HOUR, ADMIN_REPORT_MINUTE)} 약속`,
    source: "vercel luna-admin-report 0 22 * * * → KST 07:00"
  },
  eval_light: {
    promise_label: `매일 ${hhmm(CRON_EVAL_LIGHT_HOUR, CRON_EVAL_LIGHT_MINUTE)} 약속`,
    source: "cron-times CRON_EVAL_LIGHT (vercel luna-eval */10이 창에서 실행)"
  },
  consolidate: {
    promise_label: `매일 ${hhmm(CRON_CONSOLIDATE_HOUR, CRON_CONSOLIDATE_MINUTE)} 약속`,
    source: "vercel luna-consolidate 30 18 * * * → KST 03:30"
  },
  fx_rates: {
    promise_label: "매일 09:15 약속",
    source: "vercel fx-rates 15 0 * * * → KST 09:15"
  },
  disk: {
    promise_label: "상시",
    source: "별도 cron 없음 — 항상 정상으로 접음"
  }
};

export type CheckPromiseDrift = {
  id: string;
  expected: string;
  actual: string | null;
  source: string;
};

export function diffCheckPromises(
  rows: { id: string; promise_label: string }[]
): CheckPromiseDrift[] {
  const byId = new Map(rows.map((r) => [r.id, r.promise_label]));
  const drifts: CheckPromiseDrift[] = [];
  for (const [id, meta] of Object.entries(LUNA_CHECK_PROMISES)) {
    const actual = byId.get(id) ?? null;
    if (actual !== meta.promise_label) {
      drifts.push({
        id,
        expected: meta.promise_label,
        actual,
        source: meta.source
      });
    }
  }
  return drifts;
}
