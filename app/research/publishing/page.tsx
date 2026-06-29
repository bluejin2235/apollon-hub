"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { SupplyToast } from "@/components/supplies/toast";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import {
  DEFAULT_PUBLISHING_SCHEDULE,
  formatPublishingScheduleSummary,
  PUBLISHING_HOUR_OPTIONS,
  PUBLISHING_PERIOD_OPTIONS,
  PUBLISHING_SCHEDULE_KEY,
  PUBLISHING_WEEKDAY_OPTIONS,
  parsePublishingSchedule,
  publishingPeriodToDays,
  serializePublishingSchedule,
  type PublishingPeriod,
  type PublishingSchedule,
  type PublishingWeekday
} from "@/lib/research/publishing";
import { useResearchManager } from "@/lib/services/use-service-permissions";
import { supabase } from "@/lib/supabase/client";

type PeriodPickerProps = {
  period: PublishingPeriod;
  startDate: string;
  endDate: string;
  onPeriodChange: (period: PublishingPeriod) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
};

function PeriodPicker({
  period,
  startDate,
  endDate,
  onPeriodChange,
  onStartDateChange,
  onEndDateChange
}: PeriodPickerProps) {
  return (
    <div>
      <p className="text-sm font-medium text-[#0d0d0d]">수집기간</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PUBLISHING_PERIOD_OPTIONS.map((option) => {
          const selected = period === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriodChange(option.value)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "border-[#534AB7] bg-[#534AB7]/10 text-[#534AB7]"
                  : "border-[rgba(0,0,0,0.12)] text-[#676767] hover:border-[rgba(0,0,0,0.2)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {period === "custom" ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="text-xs font-medium text-[#676767]">시작일</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
            />
          </label>
          <span className="hidden pb-2 text-sm text-[#8e8e8e] sm:block">~</span>
          <label className="block flex-1">
            <span className="text-xs font-medium text-[#676767]">종료일</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export default function ResearchPublishingPage() {
  const router = useRouter();
  const { status } = useRequirePortalSession();
  const canManage = useResearchManager();

  const [schedule, setSchedule] = useState<PublishingSchedule>(DEFAULT_PUBLISHING_SCHEDULE);
  const [savedSchedule, setSavedSchedule] = useState<PublishingSchedule>(DEFAULT_PUBLISHING_SCHEDULE);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const [immediatePeriod, setImmediatePeriod] = useState<PublishingPeriod>("1week");
  const [immediateStartDate, setImmediateStartDate] = useState("");
  const [immediateEndDate, setImmediateEndDate] = useState("");
  const [triggerBusy, setTriggerBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (canManage === false) {
      router.replace("/research");
    }
  }, [canManage, router]);

  useEffect(() => {
    if (status !== "ready" || canManage !== true) return;

    void (async () => {
      setScheduleLoading(true);
      const { data, error: fetchError } = await supabase
        .from("trend_settings")
        .select("value")
        .eq("key", PUBLISHING_SCHEDULE_KEY)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setScheduleLoading(false);
        return;
      }

      const parsed = parsePublishingSchedule(data?.value);
      setSchedule(parsed);
      setSavedSchedule(parsed);
      setScheduleLoading(false);
    })();
  }, [status, canManage]);

  const handleSaveSchedule = async () => {
    if (scheduleSaving) return;

    if (schedule.period === "custom" && (!schedule.start_date || !schedule.end_date)) {
      setError("기간설정 시 시작일과 종료일을 입력해주세요.");
      return;
    }

    setScheduleSaving(true);
    setError(null);

    const { error: saveError } = await supabase.from("trend_settings").upsert(
      {
        key: PUBLISHING_SCHEDULE_KEY,
        value: serializePublishingSchedule(schedule),
        updated_at: new Date().toISOString()
      },
      { onConflict: "key" }
    );

    setScheduleSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    setSavedSchedule(schedule);
    setToast("예약 설정이 저장되었습니다.");
  };

  const handleTriggerNow = async () => {
    if (triggerBusy) return;

    if (immediatePeriod === "custom" && (!immediateStartDate || !immediateEndDate)) {
      setError("기간설정 시 시작일과 종료일을 입력해주세요.");
      return;
    }

    const days = publishingPeriodToDays(immediatePeriod, immediateStartDate, immediateEndDate);
    if (days === null) {
      setError("유효하지 않은 수집기간입니다.");
      return;
    }

    setTriggerBusy(true);
    setError(null);

    try {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError("로그인 세션이 없습니다.");
        return;
      }

      const response = await fetch("/api/research/publishing/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ days })
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Publishing 실행에 실패했습니다.");
        setToast("Publishing 실행에 실패했습니다.");
        return;
      }

      setToast("Publishing이 실행되었습니다.");
    } catch (triggerError) {
      const message =
        triggerError instanceof Error ? triggerError.message : "Publishing 실행에 실패했습니다.";
      setError(message);
      setToast("Publishing 실행에 실패했습니다.");
    } finally {
      setTriggerBusy(false);
    }
  };

  if (status === "checking" || canManage === null) {
    return <PortalAuthChecking />;
  }

  if (canManage === false) {
    return <PortalAuthChecking />;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0d0d0d]">Publishing</h1>
        <p className="mt-1 text-sm text-[#676767]">트렌드 레이더 위클리 Publishing을 예약하거나 즉시 실행합니다.</p>

        <div className="mt-6 flex flex-col gap-5">
          <section id="schedule" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
            <h2 className="text-base font-semibold text-[#534AB7]">예약 발송</h2>

            <div className="mt-5">
              <PeriodPicker
                period={schedule.period}
                startDate={schedule.start_date ?? ""}
                endDate={schedule.end_date ?? ""}
                onPeriodChange={(period) => setSchedule((prev) => ({ ...prev, period }))}
                onStartDateChange={(start_date) => setSchedule((prev) => ({ ...prev, start_date }))}
                onEndDateChange={(end_date) => setSchedule((prev) => ({ ...prev, end_date }))}
              />
            </div>

            <div className="mt-5">
              <p className="text-sm font-medium text-[#0d0d0d]">시작시점</p>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <label className="block flex-1">
                  <span className="text-xs font-medium text-[#676767]">요일</span>
                  <select
                    value={schedule.day}
                    onChange={(event) =>
                      setSchedule((prev) => ({ ...prev, day: event.target.value as PublishingWeekday }))
                    }
                    disabled={scheduleLoading}
                    className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                  >
                    {PUBLISHING_WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}요일
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block flex-1">
                  <span className="text-xs font-medium text-[#676767]">시간</span>
                  <select
                    value={schedule.hour}
                    onChange={(event) =>
                      setSchedule((prev) => ({ ...prev, hour: Number(event.target.value) }))
                    }
                    disabled={scheduleLoading}
                    className="mt-1 w-full rounded-xl border border-[rgba(0,0,0,0.12)] px-3 py-2 text-sm text-[#0d0d0d] focus:border-[#534AB7] focus:outline-none disabled:opacity-60"
                  >
                    {PUBLISHING_HOUR_OPTIONS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <p className="mt-5 rounded-xl bg-[#534AB7]/5 px-4 py-3 text-sm text-[#534AB7]">
              현재: {formatPublishingScheduleSummary(savedSchedule)}
            </p>

            <button
              type="button"
              onClick={() => void handleSaveSchedule()}
              disabled={scheduleSaving || scheduleLoading}
              className="mt-5 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
            >
              {scheduleSaving ? "저장 중…" : "저장"}
            </button>
          </section>

          <section id="trigger" className="scroll-mt-24 rounded-2xl border border-[rgba(0,0,0,0.08)] bg-white p-5">
            <h2 className="text-base font-semibold text-[#534AB7]">즉시 발송</h2>
            <p className="mt-1 text-sm text-[#676767]">선택한 수집기간으로 Publishing을 바로 실행합니다.</p>

            <div className="mt-5">
              <PeriodPicker
                period={immediatePeriod}
                startDate={immediateStartDate}
                endDate={immediateEndDate}
                onPeriodChange={setImmediatePeriod}
                onStartDateChange={setImmediateStartDate}
                onEndDateChange={setImmediateEndDate}
              />
            </div>

            <button
              type="button"
              onClick={() => void handleTriggerNow()}
              disabled={
                triggerBusy ||
                (immediatePeriod === "custom" && (!immediateStartDate || !immediateEndDate))
              }
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#534AB7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#453da0] disabled:opacity-50"
            >
              {triggerBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  실행 중…
                </>
              ) : (
                "지금 실행"
              )}
            </button>
          </section>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>

      <SupplyToast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}
