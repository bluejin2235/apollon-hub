import { after } from "next/server";
import type { NextRequest } from "next/server";

/** Vercel 함수 시간 제한 후 이어가기 — CRON_SECRET 로 자기 호출 */
export function scheduleNotionIndexContinue(
  request: NextRequest,
  runId: string
): void {
  const origin = request.nextUrl.origin;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return;
  const url = `${origin}/api/cron/notion-index?continue=${encodeURIComponent(runId)}`;
  after(() => {
    void fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` }
    }).catch((err) => {
      console.error("[notion-index] continue fetch", err);
    });
  });
}
