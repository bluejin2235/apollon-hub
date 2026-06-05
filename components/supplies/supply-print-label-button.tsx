"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  generateQrLabelImage,
  requestPrint,
  watchPrintJob,
  type PrintJobStatus
} from "@/lib/supplies/print";
import { printLabelLog } from "@/lib/supplies/print-debug";
import { formatSupplyQrPayload } from "@/lib/supplies/qr";
import type { SupplyWithRelations } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

type PrintUiState = "idle" | "generating" | "printing" | "success" | "error";

const PRINT_TIMEOUT_MS = 30_000;

type Props = {
  supply: Pick<SupplyWithRelations, "id" | "name" | "code">;
  requestedBy: string;
  onToast: (message: string) => void;
};

function isTerminalStatus(status: PrintJobStatus): status is "completed" | "failed" {
  return status === "completed" || status === "failed";
}

export function SupplyPrintLabelButton({ supply, requestedBy, onToast }: Props) {
  const [uiState, setUiState] = useState<PrintUiState>("idle");
  const unsubRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** setState 전 연타·중복 호출 방지 (동기 플래그) */
  const clickLockRef = useRef(false);
  const busy = uiState === "generating" || uiState === "printing";

  const releaseClickLock = useCallback(() => {
    clickLockRef.current = false;
  }, []);

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    cleanup();
    releaseClickLock();
  }, [cleanup, releaseClickLock]);

  const finishError = useCallback(
    (message: string) => {
      printLabelLog("UI → error", { message, uiState: "error" });
      cleanup();
      releaseClickLock();
      setUiState("error");
      onToast(message);
    },
    [cleanup, onToast, releaseClickLock]
  );

  const finishSuccess = useCallback(() => {
    printLabelLog("UI → success", { uiState: "success" });
    cleanup();
    setUiState("success");
    onToast("인쇄 완료!");
    window.setTimeout(() => {
      releaseClickLock();
      setUiState("idle");
    }, 3000);
  }, [cleanup, onToast, releaseClickLock]);

  const handleJobUpdate = useCallback(
    (status: PrintJobStatus, errorMessage: string | null, source: string) => {
      printLabelLog("job 상태 처리", { source, status, errorMessage });
      if (status === "completed") {
        finishSuccess();
        return;
      }
      if (status === "failed") {
        finishError(errorMessage?.trim() || "인쇄에 실패했습니다.");
      }
    },
    [finishError, finishSuccess]
  );

  const pollJobOnce = useCallback(
    async (jobId: string) => {
      printLabelLog("pollJobOnce 조회", { jobId });
      const { data, error } = await supabase
        .from("print_jobs")
        .select("status, error_message, processed_at, created_at")
        .eq("id", jobId)
        .maybeSingle();

      printLabelLog("pollJobOnce 결과", {
        jobId,
        error: error?.message ?? null,
        status: data?.status ?? null,
        error_message: data?.error_message ?? null,
        processed_at: data?.processed_at ?? null
      });

      if (data && isTerminalStatus(data.status as PrintJobStatus)) {
        handleJobUpdate(data.status as PrintJobStatus, data.error_message as string | null, "poll");
      }
    },
    [handleJobUpdate]
  );

  const handleClick = useCallback(async () => {
    if (clickLockRef.current) {
      printLabelLog("클릭 무시 (clickLock)");
      return;
    }
    if (busy || uiState === "success") {
      printLabelLog("클릭 무시 (busy/success)", { busy, uiState });
      return;
    }

    clickLockRef.current = true;
    cleanup();
    setUiState("generating");
    printLabelLog("버튼 클릭 → generating", {
      supplyId: supply.id,
      supplyCode: supply.code,
      requestedBy
    });

    try {
      const imageBase64 = await generateQrLabelImage(supply);
      const qrData = formatSupplyQrPayload(supply.code);
      printLabelLog("라벨 이미지 생성 완료 → printing", { qrData });

      setUiState("printing");
      const { jobId, error } = await requestPrint(
        supply.id,
        { imageBase64, qrData, supplyName: supply.name, supplyCode: supply.code },
        requestedBy
      );

      if (error || !jobId) {
        printLabelLog("requestPrint 실패 (UI)", { error, jobId });
        finishError(error ?? "인쇄 요청에 실패했습니다.");
        return;
      }

      printLabelLog("requestPrint 성공 (UI), Realtime 대기", { jobId });

      unsubRef.current = watchPrintJob(jobId, (job) => {
        if (isTerminalStatus(job.status)) {
          handleJobUpdate(job.status, job.error_message, "realtime");
        } else {
          printLabelLog("watchPrintJob 중간 상태", { jobId, status: job.status });
        }
      });

      void pollJobOnce(jobId);

      timeoutRef.current = setTimeout(() => {
        printLabelLog("30초 타임아웃", { jobId });
        finishError("인쇄 시간이 초과되었습니다. 프린터 브리지가 실행 중인지 확인해 주세요.");
      }, PRINT_TIMEOUT_MS);
    } catch (e) {
      const message = e instanceof Error ? e.message : "라벨 생성에 실패했습니다.";
      printLabelLog("예외 발생", { message, stack: e instanceof Error ? e.stack : undefined });
      finishError(message);
    }
  }, [
    busy,
    uiState,
    cleanup,
    supply,
    requestedBy,
    finishError,
    handleJobUpdate,
    pollJobOnce
  ]);

  const label =
    uiState === "generating"
      ? "라벨 생성 중…"
      : uiState === "printing"
        ? "인쇄 중…"
        : uiState === "success"
          ? "인쇄 완료"
          : uiState === "error"
            ? "인쇄 실패 — 다시 시도"
            : "QR 라벨 출력";

  const className =
    uiState === "success"
      ? "inline-flex items-center gap-2 rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800"
      : uiState === "error"
        ? "inline-flex items-center gap-2 rounded-lg border border-rose-400 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
        : busy
          ? "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-slate-500"
          : "inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void handleClick();
      }}
      disabled={busy}
      className={className}
      aria-busy={busy}
    >
      {busy ? (
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
          aria-hidden
        />
      ) : null}
      {label}
    </button>
  );
}
