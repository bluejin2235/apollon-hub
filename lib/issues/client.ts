import { supabase } from "@/lib/supabase/client";
import type {
  IssueArea,
  IssueCounts,
  IssueDetail,
  IssueKind,
  IssueListItem,
  IssueMember,
  IssueSort,
  IssueStatus,
  IssueSummary
} from "@/lib/issues/types";

async function issuesFetch(path: string, init?: RequestInit): Promise<Response> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const headers = new Headers(init?.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers });
}

export type IssueListResponse = {
  issues: IssueListItem[];
  counts: IssueCounts;
  members: IssueMember[];
  me: { id: string; name: string; is_admin: boolean };
};

export async function loadIssueList(params: {
  status?: IssueStatus | "";
  kind?: IssueKind | "";
  area?: IssueArea | "";
  q?: string;
  sort?: IssueSort;
}): Promise<IssueListResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.kind) search.set("kind", params.kind);
  if (params.area) search.set("area", params.area);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  const res = await issuesFetch(`/api/issues?${search.toString()}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as IssueListResponse;
}

export async function loadIssueSummary(): Promise<IssueSummary> {
  const res = await issuesFetch("/api/issues?summary=1");
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as IssueSummary;
}

export async function loadIssueDetail(seq: string): Promise<IssueDetail> {
  const res = await issuesFetch(`/api/issues/${encodeURIComponent(seq)}`);
  if (res.status === 404) {
    throw new Error("not_found");
  }
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as IssueDetail;
}

export async function createIssue(body: {
  kind: IssueKind;
  area: IssueArea;
  title: string;
  body: string;
}): Promise<{ seq: number; id: string }> {
  const res = await issuesFetch("/api/issues", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as { seq: number; id: string };
}

export async function patchIssue(
  id: string,
  body: {
    status?: IssueStatus;
    assignee_id?: string | null;
    title?: string;
    body?: string;
    kind?: IssueKind;
    area?: IssueArea;
  }
): Promise<void> {
  const res = await issuesFetch(`/api/issues/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function postIssueComment(
  id: string,
  body: string,
  markDone?: boolean
): Promise<void> {
  const res = await issuesFetch(`/api/issues/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, mark_done: Boolean(markDone) })
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function setIssueWatch(id: string, watch: boolean): Promise<void> {
  const res = await issuesFetch(`/api/issues/${encodeURIComponent(id)}/watch`, {
    method: watch ? "POST" : "DELETE"
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function deleteIssue(id: string): Promise<void> {
  const res = await issuesFetch(`/api/issues/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
}

export async function uploadIssueMedia(file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await issuesFetch("/api/issues/upload", {
    method: "POST",
    body: form
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
}
