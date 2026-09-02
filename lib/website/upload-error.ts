export function describeUploadError(
  error: string,
  status: number,
  details?: unknown
): { message: string; advice: string[] } {
  const rec = details && typeof details === "object" ? (details as Record<string, unknown>) : null;
  const detailMessage = typeof rec?.message === "string" ? rec.message : null;
  const advice = Array.isArray(rec?.advice)
    ? rec.advice.filter((item): item is string => typeof item === "string")
    : [];

  if (detailMessage) {
    return { message: detailMessage, advice };
  }

  if (error === "image_too_small") {
    const width = typeof rec?.width === "number" ? rec.width : null;
    const height = typeof rec?.height === "number" ? rec.height : null;
    if (width != null && height != null) {
      return {
        message: `긴 변이 1600 이상이어야 합니다. 지금 ${width}×${height} 입니다`,
        advice
      };
    }
    return { message: "긴 변이 1600 이상이어야 합니다", advice };
  }

  if (status === 413 || error === "file_too_large") {
    return {
      message: "파일이 너무 커서 서버가 받지 못했습니다",
      advice
    };
  }

  if (error === "aborted") {
    return { message: "업로드를 취소했습니다", advice };
  }
  if (error === "timeout") {
    return { message: "시간이 초과되었습니다", advice };
  }
  if (error === "network_error") {
    return { message: "연결이 끊어졌습니다", advice };
  }
  if (error === "unauthorized") {
    return { message: "로그인이 필요합니다", advice };
  }
  if (error === "process_failed") {
    return { message: "이미지를 처리하지 못했습니다", advice };
  }
  if (error === "upload_failed") {
    return { message: "저장소에 올리지 못했습니다", advice };
  }
  if (error === "unsupported_type") {
    return { message: typeof rec?.mime === "string" ? `이 형식은 올릴 수 없습니다 (${rec.mime})` : "이 형식은 올릴 수 없습니다", advice };
  }
  if (error === "website_timeout") {
    return { message: "홈페이지 서버가 응답하지 않습니다", advice };
  }
  if (error === "website_unreachable") {
    return { message: "홈페이지 서버에 연결하지 못했습니다", advice };
  }
  if (error === "request_failed" || !error) {
    return {
      message:
        status > 0
          ? `요청이 서버에 도달하지 못했습니다 (${status})`
          : "요청이 서버에 도달하지 못했습니다",
      advice
    };
  }

  return { message: error, advice };
}
