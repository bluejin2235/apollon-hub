export function describeBlockError(
  error: string,
  details?: unknown
): string {
  const rec = details && typeof details === "object" ? (details as Record<string, unknown>) : null;
  const detailMessage = typeof rec?.message === "string" ? rec.message : null;
  if (detailMessage) {
    return detailMessage;
  }

  switch (error) {
    case "video_fields_required":
      return "영상 파일 또는 주소를 먼저 입력해 주세요";
    case "invalid_video_kind":
      return "영상 종류가 올바르지 않습니다";
    case "embed_fields_required":
      return "임베드 주소를 입력해 주세요";
    case "invalid_embed_provider":
      return "지원하지 않는 임베드 종류입니다";
    case "body_required":
      return "본문을 입력해 주세요";
    case "invalid_preset":
      return "블록 종류가 올바르지 않습니다";
    case "invalid_text_side":
      return "텍스트 위치가 올바르지 않습니다";
    case "too_many_images":
      return "이미지가 너무 많습니다";
    case "preset_image_limit":
      return "이 블록 종류에 맞지 않는 이미지 수입니다";
    default:
      return error;
  }
}
