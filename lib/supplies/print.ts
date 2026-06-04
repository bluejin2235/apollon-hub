import QRCode from "qrcode";
import { supabase } from "@/lib/supabase/client";
import { printLabelLog } from "@/lib/supplies/print-debug";
import { formatSupplyQrPayload } from "@/lib/supplies/qr";
import type { SupplyWithRelations } from "@/lib/supplies/types";

/** 18mm 테이프 높이 × 가로 라벨 (135 DPI: 96×200px) */
const LABEL_HEIGHT = 96;
const LABEL_WIDTH = 200;
const H_PAD = 4;
const V_PAD = 3;
const TEXT_GAP = 5;
const NAME_FONT = "bold 18px system-ui, sans-serif";
const CODE_FONT = "bold 16px system-ui, sans-serif";
const NAME_LINE_HEIGHT = 20;
const CODE_LINE_HEIGHT = 18;
const MAX_NAME_LINES = 3;

function isCjkCharacter(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x4e00 && code <= 0x9fff)
  );
}

/** 한글·CJK는 글자 단위, 영문·숫자는 단어 단위로 줄바꿈 단위 생성 */
function tokenizeForWrap(text: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isCjkCharacter(ch)) {
      units.push(ch);
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      units.push(ch);
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && !isCjkCharacter(text[j]) && !/\s/.test(text[j])) {
      j += 1;
    }
    units.push(text.slice(i, j));
    i = j;
  }
  return units;
}

function joinWrapUnit(line: string, unit: string): string {
  if (/\s/.test(unit)) {
    return line.endsWith(" ") ? line : `${line} `;
  }
  if (!line) return unit;
  const last = line[line.length - 1];
  if (isCjkCharacter(last) && unit.length === 1 && isCjkCharacter(unit)) {
    return line + unit;
  }
  return `${line} ${unit}`;
}

function fitLineWithEllipsis(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string {
  const ellipsis = "…";
  if (ctx.measureText(line).width <= maxWidth) return line;
  let trimmed = line;
  while (trimmed.length > 0 && ctx.measureText(trimmed + ellipsis).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.length > 0 ? trimmed + ellipsis : ellipsis;
}

function wrapLabelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const units = tokenizeForWrap(text.trim());
  const lines: string[] = [];
  let current = "";
  let unitIndex = 0;

  const commitLine = () => {
    const value = current.trimEnd();
    if (value) lines.push(value);
    current = "";
  };

  while (unitIndex < units.length && lines.length < maxLines) {
    const unit = units[unitIndex];
    const candidate = joinWrapUnit(current, unit);

    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      unitIndex += 1;
      continue;
    }

    if (current) {
      commitLine();
      continue;
    }

    if (ctx.measureText(unit).width <= maxWidth) {
      current = unit;
      unitIndex += 1;
      continue;
    }

    for (const ch of unit) {
      const next = joinWrapUnit(current, ch);
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        commitLine();
        current = ch;
      }
      if (lines.length >= maxLines) break;
    }
    unitIndex += 1;
  }

  const hasRemainingUnits = unitIndex < units.length;
  const hasPendingLine = current.trimEnd().length > 0;

  if (hasPendingLine && lines.length < maxLines) {
    lines.push(current.trimEnd());
  }

  if (lines.length === 0) return [""];

  const truncated = hasRemainingUnits || (hasPendingLine && lines.length >= maxLines);
  if (truncated) {
    lines[lines.length - 1] = fitLineWithEllipsis(ctx, lines[lines.length - 1], maxWidth);
  }

  return lines.slice(0, maxLines);
}

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
 * QR(왼쪽) + 코드·비품명(오른쪽) 가로 라벨 PNG.
 * 200×96px 고정 (18mm 높이 @ 135 DPI).
 */
export async function generateQrLabelImage(
  supply: Pick<SupplyWithRelations, "id" | "name" | "code">
): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("generateQrLabelImage는 브라우저에서만 실행할 수 있습니다.");
  }

  const qrSize = LABEL_HEIGHT - V_PAD * 2;
  const qrX = H_PAD;
  const qrY = V_PAD;
  const textX = H_PAD + qrSize + TEXT_GAP;
  const textMaxWidth = LABEL_WIDTH - textX - H_PAD;

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context를 사용할 수 없습니다.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

  const qrPayload = formatSupplyQrPayload(supply.code);
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: "L"
  });

  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize);

  ctx.textBaseline = "top";

  ctx.font = CODE_FONT;
  ctx.fillStyle = "#0f172a";
  ctx.fillText(supply.code, textX, V_PAD);

  ctx.font = NAME_FONT;
  const nameLines = wrapLabelText(ctx, supply.name, textMaxWidth, MAX_NAME_LINES);
  const nameBlockHeight = nameLines.length * NAME_LINE_HEIGHT;
  let nameY = LABEL_HEIGHT - V_PAD - nameBlockHeight;
  const codeBottom = V_PAD + CODE_LINE_HEIGHT;
  const minNameY = codeBottom + TEXT_GAP;
  if (nameY < minNameY) nameY = minNameY;

  for (const line of nameLines) {
    ctx.fillText(line, textX, nameY);
    nameY += NAME_LINE_HEIGHT;
  }

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
