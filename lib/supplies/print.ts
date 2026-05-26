import QRCode from "qrcode";
import { supabase } from "@/lib/supabase/client";
import { printLabelLog } from "@/lib/supplies/print-debug";
import { formatSupplyQrPayload } from "@/lib/supplies/qr";
import type { SupplyWithRelations } from "@/lib/supplies/types";

/** 18mm 테이프 × 32mm 길이 (135 DPI: 96×170px, lbx 이미지 28mm) */
const LABEL_HEIGHT = 96;
const LABEL_WIDTH = 170;
const H_PAD = 4;
const V_PAD = 3;
const TEXT_GAP = 5;
const NAME_FONT = "bold 13px system-ui, sans-serif";
const CODE_FONT = "11px system-ui, sans-serif";

/** supplyId 단위 동시 requestPrint 1회만 허용 */
const inFlightPrintBySupply = new Map<
  string,
  Promise<{ jobId: string | null; error: string | null }>
>();

export type PrintJobPayload = {
  imageBase64: string;
  qrData: string;
  supplyName: string;
  supplyCode: string;
};

export type PrintJobStatus = "pending" | "processing" | "completed" | "failed";

export type PrintJob = {
  id: string;
  status: PrintJobStatus;
  error_message: string | null;
  processed_at: string | null;
};

/**
 * QR(왼쪽) + 비품명·코드(오른쪽) 가로 라벨 PNG.
 * 170×96px 고정 (32mm × 18mm @ 135 DPI).
 */
export async function generateQrLabelImage(
  supply: Pick<SupplyWithRelations, "id" | "name" | "code">
): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("generateQrLabelImage는 브라우저에서만 실행할 수 있습니다.");
  }

  const qrSize = LABEL_HEIGHT - V_PAD * 2;
  const name = supply.name.length > 24 ? `${supply.name.slice(0, 23)}…` : supply.name;

  const qrX = H_PAD;
  const qrY = V_PAD;
  const textX = H_PAD + qrSize + TEXT_GAP;

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context를 사용할 수 없습니다.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

  const qrPayload = formatSupplyQrPayload(supply.id);
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: "M"
  });

  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = "#0f172a";
  ctx.font = NAME_FONT;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(name, textX, Math.round(LABEL_HEIGHT * 0.375));

  ctx.fillStyle = "#64748b";
  ctx.font = CODE_FONT;
  ctx.fillText(supply.code, textX, Math.round(LABEL_HEIGHT * 0.6875));

  const dataUrl = canvas.toDataURL("image/png");
  printLabelLog("generateQrLabelImage 완료", {
    labelWidth: LABEL_WIDTH,
    labelHeight: LABEL_HEIGHT,
    imageBytesApprox: Math.round((dataUrl.length * 3) / 4)
  });
  return dataUrl;
}

/** print_jobs 큐에 인쇄 요청 등록 (동일 supplyId 중복 INSERT 방지) */
export async function requestPrint(
  supplyId: string,
  payload: PrintJobPayload,
  requestedBy: string
): Promise<{ jobId: string | null; error: string | null }> {
  const existing = inFlightPrintBySupply.get(supplyId);
  if (existing) {
    printLabelLog("requestPrint 중복 차단 (진행 중인 요청 재사용)", { supplyId });
    return existing;
  }

  const promise = (async (): Promise<{ jobId: string | null; error: string | null }> => {
    printLabelLog("requestPrint 호출", {
      supplyId,
      requestedBy,
      qrData: payload.qrData,
      hasImage: Boolean(payload.imageBase64)
    });

    const { data, error } = await supabase
      .from("print_jobs")
      .insert({
        supply_id: supplyId,
        requested_by: requestedBy,
        payload,
        printer_name: "Brother PT-P750W"
      })
      .select("id, status, created_at")
      .single();

    if (error) {
      printLabelLog("requestPrint insert 실패", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return { jobId: null, error: error.message };
    }

    printLabelLog("requestPrint insert 성공", {
      jobId: data.id,
      status: data.status,
      created_at: data.created_at
    });
    return { jobId: data.id as string, error: null };
  })();

  inFlightPrintBySupply.set(supplyId, promise);
  try {
    return await promise;
  } finally {
    if (inFlightPrintBySupply.get(supplyId) === promise) {
      inFlightPrintBySupply.delete(supplyId);
    }
  }
}

/** Supabase print_jobs 최근 N건 (브라우저 콘솔 디버그용) */
export async function debugFetchRecentPrintJobs(limit = 5) {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("id, supply_id, status, error_message, created_at, processed_at, requested_by")
    .order("created_at", { ascending: false })
    .limit(limit);

  printLabelLog("최근 print_jobs 조회", {
    error: error?.message ?? null,
    rows: data
  });
  return { data, error };
}

/** 특정 job 행 조회 (브라우저 콘솔 디버그용) */
export async function debugFetchPrintJob(jobId: string) {
  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  printLabelLog("print_job 단건 조회", {
    jobId,
    error: error?.message ?? null,
    row: data
      ? {
          id: data.id,
          status: data.status,
          error_message: data.error_message,
          processed_at: data.processed_at,
          created_at: data.created_at
        }
      : null
  });
  return { data, error };
}

/** 특정 작업의 상태 변경 Realtime 구독. 반환값은 unsubscribe 함수 */
export function watchPrintJob(jobId: string, callback: (job: PrintJob) => void): () => void {
  printLabelLog("watchPrintJob 구독 시작", { jobId });

  const channel = supabase
    .channel(`print_job:${jobId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "print_jobs",
        filter: `id=eq.${jobId}`
      },
      (payload) => {
        const row = payload.new as Record<string, unknown>;
        const job: PrintJob = {
          id: String(row.id),
          status: row.status as PrintJobStatus,
          error_message: (row.error_message as string | null) ?? null,
          processed_at: (row.processed_at as string | null) ?? null
        };
        printLabelLog("watchPrintJob UPDATE 수신", {
          jobId,
          status: job.status,
          error_message: job.error_message
        });
        callback(job);
      }
    )
    .subscribe((status, err) => {
      printLabelLog("watchPrintJob 채널 상태", { jobId, status, error: err?.message ?? null });
    });

  return () => {
    printLabelLog("watchPrintJob 구독 해제", { jobId });
    void supabase.removeChannel(channel);
  };
}
