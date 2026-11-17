"use client";

/**
 * 「지금 방문객 · 보고 있는 콘텐츠」. GA4 Realtime 을 30초마다 받는다.
 * 실시간 자료에는 주소가 없어 국문/영문을 가릴 수 없으므로 배지를 붙이지 않는다.
 */

import { useEffect, useState } from "react";

import { getStatsRealtime } from "@/lib/website/api";

const TITLE_TAILS = [" | 아폴론이머시브웍스", " | Apollon Immersive Works"];
const ROLL_MS = 5_000;
const MAX_TITLES = 5;

/** 제목 끝의 사이트 이름을 떼고, 빈 값과 (other) 는 뺀다 — 지금 화면과 같은 규칙 */
function cleanTitle(name: string): string | null {
  let text = name.trim();
  if (!text || text === "(other)") return null;
  let tail = TITLE_TAILS.find((item) => text.endsWith(item));
  while (tail) {
    text = text.slice(0, -tail.length).trim();
    tail = TITLE_TAILS.find((item) => text.endsWith(item));
  }
  return text && text !== "(other)" ? text : null;
}

function useLive(): { count: number | null; titles: string[] } {
  const [live, setLive] = useState<{ count: number | null; titles: string[] }>({ count: null, titles: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function pull() {
      const result = await getStatsRealtime(controller.signal);
      if (cancelled) return;
      if (!result.ok || result.data.activeUsers === null) {
        setLive({ count: null, titles: [] });
        return;
      }
      const titles = [...new Set(result.data.pages.map((page) => cleanTitle(page.name)).filter((t): t is string => Boolean(t)))].slice(
        0,
        MAX_TITLES
      );
      const count = result.data.activeUsers;
      setLive((prev) =>
        prev.count === count && prev.titles.join("\n") === titles.join("\n") ? prev : { count, titles }
      );
    }
    void pull();
    const timer = setInterval(() => void pull(), 30_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return live;
}

function Roll({ titles }: { titles: string[] }) {
  const [at, setAt] = useState(0);

  useEffect(() => {
    setAt(0);
    if (titles.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setAt((current) => (current + 1) % titles.length), ROLL_MS);
    return () => clearInterval(timer);
  }, [titles]);

  return (
    <div className="v3-roll" aria-label={`보고 있는 콘텐츠: ${titles.join(", ")}`}>
      <div className="v3-roll-track" data-at={at} aria-hidden="true">
        {titles.map((title) => (
          <div className="v3-roll-item" key={title}>
            {title}
          </div>
        ))}
      </div>
    </div>
  );
}

export function V3Live() {
  const live = useLive();
  return (
    <div className="v3-live">
      <span className="v3-dot" />
      <strong>지금 방문객 {live.count === null ? "—" : `${live.count}명`}</strong>
      <span className="v3-tiny">최근 30분</span>
      {live.titles.length > 0 ? (
        <>
          <span className="v3-divider" />
          <span className="v3-muted">보고 있는 콘텐츠</span>
          <Roll titles={live.titles} />
        </>
      ) : null}
    </div>
  );
}
