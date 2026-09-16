/**
 * 정기 작업 지연 경고 문구
 *   npx tsx scripts/verify-stale-jobs.ts
 */
import {
  formatStaleIdleLine,
  kstCalendarDaysAgo,
  lightEmoji,
  lightFromThresholds
} from "../lib/luna-admin/traffic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = new Date("2026-09-16T00:00:00+09:00");

assert(lightFromThresholds(0, 7, 14) === "green", "today green");
assert(lightFromThresholds(6, 7, 14) === "green", "6d green");
assert(lightFromThresholds(7, 7, 14) === "yellow", "7d yellow");
assert(lightFromThresholds(13, 7, 14) === "yellow", "13d yellow");
assert(lightFromThresholds(14, 7, 14) === "red", "14d red");
assert(lightFromThresholds(null, 7, 14) === "red", "missing red");
assert(lightFromThresholds(2, 2, 3) === "yellow", "daily 2d yellow");
assert(lightFromThresholds(3, 2, 3) === "red", "daily 3d red");

assert(formatStaleIdleLine("모델 시세", 32) === "모델 시세 32일째 멈춤", "line");
assert(formatStaleIdleLine("환율", null) === "환율 실행 기록이 없습니다", "missing line");
assert(lightEmoji("yellow") === "🟡", "yellow emoji");

const marketAt = "2026-08-15T06:05:53.865Z";
assert(kstCalendarDaysAgo(marketAt, now) === 32, `days ${kstCalendarDaysAgo(marketAt, now)}`);

const days = kstCalendarDaysAgo(marketAt, now);
const light = lightFromThresholds(days, 7, 14);
assert(light === "red", "32d red");
assert(
  `${lightEmoji(light)} ${formatStaleIdleLine("모델 시세", days)}` ===
    "🔴 모델 시세 32일째 멈춤",
  "emoji line"
);

const freshDays = kstCalendarDaysAgo("2026-09-13T19:20:00.000Z", now);
assert(lightFromThresholds(freshDays, 7, 14) === "green", "fresh skip");

console.log("OK stale-jobs");
