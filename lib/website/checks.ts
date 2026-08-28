import type { CheckWorks, WorkListItem } from "@/lib/website/types";

export const PROBLEM_FLAGS = [
  "missing_summary_en",
  "missing_key_alt",
  "no_key_image",
  "key_image_size_unknown",
  "key_image_not_16_9",
  "key_image_too_small",
  "no_sections",
  "missing_image_alt",
  "ai_unconfirmed"
] as const;

export const WARN_FLAGS = [
  "body_image_too_small",
  "empty_blocks",
  "no_small_loop",
  "faq_on_but_empty",
  "too_many_anchors",
  "no_tags",
  "no_related",
  "no_internal_folder",
  "summary_too_long",
  "duplicate_captions",
  "duplicate_alts"
] as const;

export const CHECK_FLAG_COUNT = PROBLEM_FLAGS.length + WARN_FLAGS.length;

export const CHECK_FLAG_LABEL: Record<(typeof PROBLEM_FLAGS)[number] | (typeof WARN_FLAGS)[number], string> =
  {
    missing_summary_en: "영문 요약이 없습니다",
    missing_key_alt: "대표 이미지 대체 텍스트가 없습니다",
    no_key_image: "대표 이미지가 없습니다",
    key_image_size_unknown: "대표 이미지 크기 정보가 없습니다",
    key_image_not_16_9: "대표 이미지 비율이 16:9가 아닙니다",
    key_image_too_small: "대표 이미지 해상도가 낮습니다",
    body_image_too_small: "본문 이미지 해상도가 낮습니다",
    empty_blocks: "이미지가 없는 본문 블록이 있습니다",
    no_sections: "본문 섹션이 없습니다",
    missing_image_alt: "이미지 대체 텍스트가 없습니다",
    ai_unconfirmed: "AI가 만든 이미지를 아직 확인하지 않았습니다",
    no_small_loop: "T-S · 작은 화면용 루프 영상이 없습니다",
    faq_on_but_empty: "FAQ가 켜져 있으나 비어 있습니다",
    too_many_anchors: "목차 앵커가 너무 많습니다",
    no_tags: "태그가 없습니다",
    no_related: "연결 콘텐츠가 없습니다",
    no_internal_folder: "내부 폴더가 없습니다",
    summary_too_long: "요약이 너무 깁니다",
    duplicate_captions: "캡션이 중복됩니다",
    duplicate_alts: "대체 텍스트가 중복됩니다"
  };

export type HealthIssue = {
  workId: string;
  title: string;
  flag: (typeof PROBLEM_FLAGS)[number] | (typeof WARN_FLAGS)[number];
  kind: "problem" | "warn";
  label: string;
};

export function workTitle(item: WorkListItem): string {
  return item.title?.ko?.trim() || item.check?.title_ko || item.slug;
}

export function summarizeChecks(items: WorkListItem[]): {
  problem: number;
  warn: number;
  pass: number;
  issues: HealthIssue[];
  published: number;
  draft: number;
  images: number;
  captions: number;
} {
  let problem = 0;
  let warn = 0;
  const issues: HealthIssue[] = [];
  let published = 0;
  let draft = 0;
  let images = 0;
  let captions = 0;

  for (const item of items) {
    if (item.status === "published") published += 1;
    else draft += 1;
    const check = item.check;
    if (!check) continue;
    images += Number(check.image_count ?? 0);
    captions += Number(check.caption_count ?? 0);

    for (const flag of PROBLEM_FLAGS) {
      if (check[flag]) {
        problem += 1;
        issues.push({
          workId: item.id,
          title: workTitle(item),
          flag,
          kind: "problem",
          label: CHECK_FLAG_LABEL[flag]
        });
      }
    }
    for (const flag of WARN_FLAGS) {
      if (check[flag]) {
        warn += 1;
        issues.push({
          workId: item.id,
          title: workTitle(item),
          flag,
          kind: "warn",
          label:
            flag === "duplicate_captions" && check.duplicate_caption_count
              ? `캡션이 중복됩니다 (${check.duplicate_caption_count}건)`
              : flag === "duplicate_alts" && check.duplicate_alt_count
                ? `대체 텍스트가 중복됩니다 (${check.duplicate_alt_count}건)`
                : CHECK_FLAG_LABEL[flag]
        });
      }
    }
  }

  const pass = Math.max(0, items.length * CHECK_FLAG_COUNT - problem - warn);
  return { problem, warn, pass, issues, published, draft, images, captions };
}

export function fillBasic(check: CheckWorks | null): "ok" | "warn" {
  if (!check) return "warn";
  if (
    check.missing_key_alt ||
    check.missing_summary_en ||
    check.summary_too_long ||
    check.no_key_image ||
    check.key_image_size_unknown ||
    check.key_image_not_16_9 ||
    check.key_image_too_small
  ) {
    return "warn";
  }
  return "ok";
}

export function fillBody(check: CheckWorks | null): "ok" | "warn" {
  if (!check) return "warn";
  if (
    check.no_sections ||
    check.missing_image_alt ||
    check.ai_unconfirmed ||
    check.body_image_too_small ||
    check.empty_blocks ||
    check.duplicate_captions ||
    check.duplicate_alts
  ) {
    return "warn";
  }
  return "ok";
}

export function fillFaq(check: CheckWorks | null): "empty" | "warn" {
  if (check?.faq_on_but_empty) return "warn";
  return "empty";
}

export function fillRelated(check: CheckWorks | null): "ok" | "empty" {
  if (!check || check.no_related) return "empty";
  return "ok";
}
