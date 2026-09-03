"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { showToast } from "@/components/website/toast";
import { useWebsitePermissions } from "@/components/website/website-permissions";
import { PrimaryBtn } from "@/components/website/work-editor-ui";
import {
  createJob,
  getJobTargets,
  getTalentTargetsByRole,
  listJobs,
  listTalentPool,
  reorderJobs,
  updateJob
} from "@/lib/website/api";
import {
  JOB_EMPLOYMENTS,
  JOB_EXPERIENCES,
  JOB_ROLE_LABEL,
  JOB_ROLES,
  TALENT_INTEREST_LABEL,
  formatDotDate,
  interestLabels,
  type JobPosting,
  type JobRole,
  type JobStatus,
  type TalentPoolItem,
  type TalentPoolList
} from "@/lib/website/career";

type Tab = "jobs" | "alerts" | "page";

const TABS: { id: Tab; label: string }[] = [
  { id: "jobs", label: "공고" },
  { id: "alerts", label: "채용 알림 신청" },
  { id: "page", label: "페이지 설정" }
];

function httpsOk(value: string | null | undefined) {
  return Boolean(value && /^https:\/\//i.test(value.trim()));
}

function JobForm({
  job,
  canManage,
  onClose,
  onSaved
}: {
  job: JobPosting | null;
  canManage: boolean;
  onClose: () => void;
  onSaved: (row: JobPosting) => void;
}) {
  const [title, setTitle] = useState(job?.title ?? "");
  const [role, setRole] = useState<JobRole>(job?.role ?? "space-design");
  const [employment, setEmployment] = useState(job?.employment ?? "정규직");
  const [experience, setExperience] = useState(job?.experience ?? "무관");
  const [applyUrl, setApplyUrl] = useState(job?.apply_url ?? "");
  const [postedAt, setPostedAt] = useState(job?.posted_at?.slice(0, 10) ?? "");
  const [closesAt, setClosesAt] = useState(job?.closes_at?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [targetCount, setTargetCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (job?.id) {
        const result = await getJobTargets(job.id);
        if (!cancelled && result.ok) setTargetCount(result.data.count);
        return;
      }
      const result = await getTalentTargetsByRole(role);
      if (!cancelled && result.ok) setTargetCount(result.data.count);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [job?.id, role]);

  const titleLen = title.trim().length;
  const canPublish = httpsOk(applyUrl) && Boolean(postedAt);
  const publishHint =
    targetCount == null
      ? "이 직군 알림 신청자 수를 확인하는 중"
      : `이 직군 알림 신청자 ${targetCount}명에게 메일이 갑니다`;

  async function save(status?: JobStatus) {
    if (!canManage) return;
    if (titleLen < 2) {
      showToast({ message: "포지션명을 입력하세요", tone: "warn" });
      return;
    }
    if (applyUrl.trim() && !httpsOk(applyUrl)) {
      showToast({ message: "사람인 링크는 https로 시작해야 합니다", tone: "warn" });
      return;
    }
    if (status === "open" && !canPublish) {
      showToast({ message: "게시하려면 사람인 링크와 게시일이 필요합니다", tone: "warn" });
      return;
    }

    const body = {
      title: title.trim(),
      role,
      employment,
      experience,
      apply_url: applyUrl.trim() || null,
      posted_at: postedAt || null,
      closes_at: closesAt || null,
      ...(status ? { status } : {})
    };

    setSaving(true);
    const saved = job ? await updateJob(job.id, body) : await createJob(body);
    if (!saved.ok) {
      setSaving(false);
      showToast({
        message:
          saved.error === "publish_not_ready"
            ? "링크와 게시일 없이 게시할 수 없습니다"
            : "저장에 실패했습니다",
        tone: "error"
      });
      return;
    }

    if (status === "open" && saved.data.status !== "open") {
      const published = await updateJob(saved.data.id, { status: "open" });
      setSaving(false);
      if (!published.ok) {
        showToast({
          message:
            published.error === "publish_not_ready"
              ? "링크와 게시일 없이 게시할 수 없습니다"
              : "저장은 됐지만 게시하지 못했습니다",
          tone: "error"
        });
        onSaved(saved.data);
        return;
      }
      showToast({ message: "게시했습니다", tone: "ok" });
      onSaved(published.data);
      return;
    }

    setSaving(false);
    showToast({ message: status === "open" ? "게시했습니다" : "저장했습니다", tone: "ok" });
    onSaved(saved.data);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{job ? "공고 수정" : "공고 등록"}</h2>
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2 block">
          <span className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
            포지션명
            <span className="text-slate-400">{titleLen}</span>
          </span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canManage}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">직군</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as JobRole)}
            disabled={!canManage}
          >
            {JOB_ROLES.map((id) => (
              <option key={id} value={id}>
                {JOB_ROLE_LABEL[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">고용형태</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={employment}
            onChange={(event) => setEmployment(event.target.value)}
            disabled={!canManage}
          >
            {JOB_EMPLOYMENTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">경력</span>
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={experience}
            onChange={(event) => setExperience(event.target.value)}
            disabled={!canManage}
          >
            {JOB_EXPERIENCES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">사람인 링크</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={applyUrl}
            onChange={(event) => setApplyUrl(event.target.value)}
            placeholder="https://"
            disabled={!canManage}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">게시일</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={postedAt ?? ""}
            onChange={(event) => setPostedAt(event.target.value)}
            disabled={!canManage}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">마감일</span>
          <input
            type="date"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={closesAt ?? ""}
            onChange={(event) => setClosesAt(event.target.value)}
            disabled={!canManage}
          />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PrimaryBtn disabled={!canManage || saving} onClick={() => void save()}>
          저장
        </PrimaryBtn>
        <PrimaryBtn disabled={!canManage || saving} onClick={() => void save("open")}>
          게시
        </PrimaryBtn>
        <p className="text-sm text-slate-500">{publishHint}</p>
      </div>
    </div>
  );
}

function JobGroup({
  title,
  items,
  faded,
  canDrag,
  canManage,
  onEdit,
  onReorder,
  onClose
}: {
  title: string;
  items: JobPosting[];
  faded?: boolean;
  canDrag: boolean;
  canManage: boolean;
  onEdit: (job: JobPosting) => void;
  onReorder: (items: JobPosting[]) => void;
  onClose: (job: JobPosting) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <section className={faded ? "opacity-60" : undefined}>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        {title} <span className="font-normal text-slate-400">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">없음</p>
      ) : (
        <ul className="space-y-2">
          {items.map((job) => (
            <li
              key={job.id}
              draggable={canDrag && canManage}
              onDragStart={() => setDragId(job.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (!dragId || dragId === job.id) return;
                const from = items.findIndex((item) => item.id === dragId);
                const to = items.findIndex((item) => item.id === job.id);
                if (from < 0 || to < 0) return;
                const next = [...items];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                onReorder(next);
                setDragId(null);
              }}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(job)}>
                <p className="truncate text-sm font-medium text-slate-900">{job.title}</p>
                <p className="text-xs text-slate-500">
                  {JOB_ROLE_LABEL[job.role] ?? job.role} · {job.employment}
                  {!job.apply_url && job.status === "draft" ? (
                    <span className="ml-2 font-semibold text-rose-600">링크 없음</span>
                  ) : null}
                </p>
              </button>
              {job.status === "open" && canManage ? (
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-800"
                  onClick={() => onClose(job)}
                >
                  종료
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JobsTab() {
  const { canManageWorks } = useWebsitePermissions();
  const [items, setItems] = useState<JobPosting[]>([]);
  const [editing, setEditing] = useState<JobPosting | null | "new">(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await listJobs();
    if (result.ok) setItems(result.data.items);
    else showToast({ message: "공고를 불러오지 못했습니다", tone: "error" });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = items.filter((item) => item.status === "open");
  const draft = items.filter((item) => item.status === "draft");
  const closed = items.filter((item) => item.status === "closed");

  async function persistOrder(next: JobPosting[]) {
    const order = next.map((item, index) => ({ id: item.id, sort: index }));
    const result = await reorderJobs(order);
    if (!result.ok) {
      showToast({ message: "순서를 바꾸지 못했습니다", tone: "error" });
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <PrimaryBtn disabled={!canManageWorks} onClick={() => setEditing("new")}>
          새 공고
        </PrimaryBtn>
      </div>
      {editing === "new" ? (
        <JobForm
          key="new"
          job={null}
          canManage={canManageWorks}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(row);
            void load();
          }}
        />
      ) : editing ? (
        <JobForm
          key={editing.id}
          job={editing}
          canManage={canManageWorks}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            setEditing(row);
            void load();
          }}
        />
      ) : null}
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <JobGroup
            title="진행 중"
            items={open}
            canDrag
            canManage={canManageWorks}
            onEdit={setEditing}
            onReorder={(next) => void persistOrder(next)}
            onClose={(job) =>
              void updateJob(job.id, { status: "closed" }).then((result) => {
                if (!result.ok) showToast({ message: "종료하지 못했습니다", tone: "error" });
                void load();
              })
            }
          />
          <JobGroup
            title="초안"
            items={draft}
            canDrag
            canManage={canManageWorks}
            onEdit={setEditing}
            onReorder={(next) => void persistOrder(next)}
            onClose={() => undefined}
          />
          <JobGroup
            title="종료"
            items={closed}
            faded
            canDrag={false}
            canManage={canManageWorks}
            onEdit={setEditing}
            onReorder={() => undefined}
            onClose={() => undefined}
          />
        </div>
      )}
    </div>
  );
}

function AlertsTab() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState<"active" | "all" | "expired">("active");
  const [data, setData] = useState<TalentPoolList | null>(null);

  const load = useCallback(async () => {
    const result = await listTalentPool({
      q: q.trim() || undefined,
      role: role || undefined,
      filter
    });
    if (result.ok) setData(result.data);
    else showToast({ message: "신청 목록을 불러오지 못했습니다", tone: "error" });
  }, [q, role, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.counts ?? []) map.set(row.role, Number(row.n));
    return map;
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="발송 대상" value={data?.summary.active ?? 0} />
        <SummaryCard label="만료" value={data?.summary.expired ?? 0} />
        <SummaryCard label="30일 안에 만료" value={data?.summary.expiringSoon ?? 0} />
      </div>
      <div className="flex flex-wrap gap-2">
        {[...JOB_ROLES, "all"].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setRole(role === id ? "" : id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              role === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {TALENT_INTEREST_LABEL[id] ?? id} {countMap.get(id) ?? 0}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="이름 · 이메일"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value as "active" | "all" | "expired")}
        >
          <option value="active">발송 대상만</option>
          <option value="all">만료 포함</option>
          <option value="expired">만료만</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">관심 직군</th>
              <th className="px-3 py-2 font-medium">이메일</th>
              <th className="px-3 py-2 font-medium">신청일</th>
              <th className="px-3 py-2 font-medium">알림 기한</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <AlertRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">해당하는 신청이 없습니다</p>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function AlertRow({ row }: { row: TalentPoolItem }) {
  return (
    <tr className={row.is_active ? "border-t border-slate-100" : "border-t border-slate-100 opacity-50"}>
      <td className="px-3 py-2 text-slate-900">{row.name}</td>
      <td className="px-3 py-2 text-slate-600">{interestLabels(row.interests)}</td>
      <td className="px-3 py-2 text-slate-600">{row.email}</td>
      <td className="px-3 py-2 text-slate-600">{formatDotDate(row.created_at)}</td>
      <td className={`px-3 py-2 ${row.is_active ? "text-slate-600" : "text-slate-400 line-through"}`}>
        {formatDotDate(row.notify_until)}
      </td>
    </tr>
  );
}

export function WebsiteCareer() {
  const [tab, setTab] = useState<Tab>("jobs");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">커리어</h1>
        <p className="mt-1 text-sm text-slate-500">공고는 사람인으로 넘깁니다. 홈페이지에는 목록과 알림만 둡니다.</p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === item.id ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "jobs" ? <JobsTab /> : null}
      {tab === "alerts" ? <AlertsTab /> : null}
      {tab === "page" ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center text-sm text-slate-400">
          페이지 설정은 준비 중입니다
        </div>
      ) : null}
    </div>
  );
}
