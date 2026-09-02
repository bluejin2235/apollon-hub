export type WorkSiteVisibility = "draft" | "live" | "hidden";

export type PublishPreviewResult = {
  changedFields: string[];
  firstPublish: boolean;
};

export type PublishResult = {
  version: number;
  publishedAt: string;
  changedFields: string[];
  checkProblems?: string[];
};

export type PublishHistoryItem = {
  version: number;
  published_at: string;
  published_by: string | null;
  change_note: string | null;
  changed_fields: string[];
  is_current: boolean;
  is_hidden: boolean;
};

/** 바뀐 칸 이름만 넘겨 공개 요약문 초안을 만듭니다 */
export function fallbackChangeNote(changedFields: string[]): string {
  if (changedFields.length === 0) {
    return "내용을 수정했습니다";
  }
  return `${changedFields.join(" · ")}을(를) 수정했습니다`;
}

export function firstPublishNote() {
  return "처음 공개했습니다";
}
