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
  if (error === "signed_url_failed") {
    return { message: detailMessage ?? "서명 주소를 만들지 못했습니다", advice };
  }
  if (error === "invalid_kind") {
    return { message: "이 종류는 서명 업로드를 할 수 없습니다", advice };
  }
  if (error === "work_not_found") {
    return { message: "워크를 찾지 못했습니다", advice };
  }
  if (error === "upload_failed") {
    return { message: detailMessage ?? "저장소에 올리지 못했습니다", advice };
  }
  if (error === "upload_body_read_failed") {
    return {
      message:
        detailMessage ??
        "업로드 본문을 읽지 못했습니다. 파일이 200MB를 넘거나 전송 중 끊겼을 수 있습니다",
      advice
    };
  }
  if (error === "upload_error" || error === "proxy_failed") {
    return {
      message: detailMessage ?? "서버에서 업로드를 처리하지 못했습니다",
      advice
    };
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
        detailMessage ??
        (status > 0
          ? `서버 오류 (${status})`
          : "업로드 요청에 실패했습니다"),
      advice
    };
  }

  return { message: error, advice };
}
