export const ISSUE_KINDS = ["안 돼요", "이렇게 됐으면", "물어봐요"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

export const ISSUE_STATUSES = ["접수", "실행 중", "완료", "보류", "취소"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_BOARD_STATUSES = ["접수", "실행 중", "완료", "보류"] as const;
export type IssueBoardStatus = (typeof ISSUE_BOARD_STATUSES)[number];

export const ISSUE_AREAS = ["홈페이지", "라이선스", "물품창고", "루나", "그 밖"] as const;
export type IssueArea = (typeof ISSUE_AREAS)[number];

export const ISSUE_SORTS = ["최신순", "오래된순", "댓글 많은순"] as const;
export type IssueSort = (typeof ISSUE_SORTS)[number];

export const ISSUE_NOTIFY_NAME = "이택진";
export const HUB_ISSUES_URL = "https://hub.apollonworks.com/issues";
export const HUB_ISSUE_CATEGORY = "hub_issue";

export type IssueMember = {
  id: string;
  name: string;
};

export type IssueListItem = {
  id: string;
  seq: number;
  kind: IssueKind;
  area: string;
  title: string;
  status: IssueStatus;
  author_id: string;
  author_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  comment_count: number;
};

export type IssueCounts = {
  접수: number;
  "실행 중": number;
  완료: number;
  보류: number;
  취소: number;
};

export type IssueEventKind = "status" | "assignee" | "edit";

export type IssueTimelineItem =
  | {
      type: "body";
      id: string;
      author_id: string;
      author_name: string;
      body: string;
      created_at: string;
    }
  | {
      type: "comment";
      id: string;
      author_id: string;
      author_name: string;
      body: string;
      created_at: string;
    }
  | {
      type: "event";
      id: string;
      actor_id: string;
      actor_name: string;
      kind: IssueEventKind;
      from_value: string | null;
      to_value: string | null;
      created_at: string;
    };

export type IssueDetail = {
  id: string;
  seq: number;
  kind: IssueKind;
  area: string;
  title: string;
  body: string;
  status: IssueStatus;
  author_id: string;
  author_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  closed_at: string | null;
  watchers: IssueMember[];
  members: IssueMember[];
  timeline: IssueTimelineItem[];
  watching: boolean;
  can_manage: boolean;
  can_assign: boolean;
  can_edit: boolean;
};

export type IssueSummary = {
  접수: number;
  "실행 중": number;
  recent: Array<{
    id: string;
    seq: number;
    kind: IssueKind;
    title: string;
  }>;
};

export function isIssueKind(value: string): value is IssueKind {
  return (ISSUE_KINDS as readonly string[]).includes(value);
}

export function isIssueStatus(value: string): value is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(value);
}

export function isIssueArea(value: string): value is IssueArea {
  return (ISSUE_AREAS as readonly string[]).includes(value);
}

export function isIssueSort(value: string): value is IssueSort {
  return (ISSUE_SORTS as readonly string[]).includes(value);
}

export function kindClass(kind: IssueKind): string {
  if (kind === "안 돼요") return "bug";
  if (kind === "이렇게 됐으면") return "idea";
  return "ask";
}

export function statusClass(status: IssueStatus): string {
  if (status === "접수") return "new";
  if (status === "실행 중") return "doing";
  if (status === "완료") return "done";
  if (status === "보류") return "hold";
  return "no";
}

export function isDimmedStatus(status: IssueStatus): boolean {
  return status === "완료" || status === "취소";
}

export function nameInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "?";
}
