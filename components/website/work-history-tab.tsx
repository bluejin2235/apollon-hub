"use client";

import { useEffect, useState } from "react";
import { getPublishHistory, type PublishHistoryItem } from "@/lib/website/api";
import "./ui/work-admin.css";

type Props = {
  workId: string;
  contentType?: "work" | "insight";
};

function formatHistoryWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayPeriod = pick("dayPeriod");
  const hour = pick("hour");
  const minute = pick("minute");
  return `${pick("year")}. ${pick("month")}. ${pick("day")} ${dayPeriod} ${hour}:${minute}`;
}

export function WorkHistoryTab({ workId, contentType = "work" }: Props) {
  const [items, setItems] = useState<PublishHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPublishHistory(contentType, workId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setItems([]);
        return;
      }
      setItems(res.data.items);
    });
    return () => {
      cancelled = true;
    };
  }, [workId, contentType]);

  const list = items ?? [];

  return (
    <div className="wa">
      <div className="grph">
        <h3>이력</h3>
        <span className="cnt">공개할 때마다 남습니다</span>
      </div>
      <p className="grpd">
        저장은 남지 않습니다. 「공개하기」를 누른 것만 기록됩니다. 공개 팝업에서 쓴 문장이 그대로
        들어갑니다.
      </p>

      {error ? <p className="mb-3 text-xs text-rose-600">{error}</p> : null}

      <div className="box flush">
        {items !== null && list.length === 0 ? (
          <p className="empty-hist">아직 공개하지 않았습니다</p>
        ) : (
          list.map((item) => {
            const who = item.published_by_name;
            const when = formatHistoryWhen(item.published_at);
            const meta = [`v${item.version}`, when, who].filter(Boolean).join(" · ");
            return (
              <div className="hitem" key={item.version}>
                <div className="hmeta">
                  {item.is_current ? <span className="badge now">지금 공개 중</span> : null}
                  <span>{meta}</span>
                </div>
                <div className={item.is_current ? "hnote" : "hnote old"}>{item.change_note}</div>
              </div>
            );
          })
        )}
      </div>

      <p className="hint-line">
        되돌리기는 없습니다. 지난 내용을 보려면 그 버전의 요약만 확인할 수 있습니다.
      </p>
    </div>
  );
}
