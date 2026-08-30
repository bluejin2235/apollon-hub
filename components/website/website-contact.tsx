"use client";

import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/website/toast";
import { PrimaryBtn } from "@/components/website/work-editor-ui";
import { listInquiries, updateInquiry } from "@/lib/website/api";
import { formatDotDate } from "@/lib/website/career";
import {
  INQUIRY_FILTERS,
  budgetLabel,
  messagePreview,
  timelineLabel,
  type InquiryFilter,
  type InquiryItem,
  type InquiryList
} from "@/lib/website/contact";

type Tab = "inbox" | "page";

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function InquiryDetail({
  item,
  onChanged
}: {
  item: InquiryItem;
  onChanged: (row: InquiryItem) => void;
}) {
  const [memo, setMemo] = useState(item.memo ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMemo(item.memo ?? "");
  }, [item.id, item.memo]);

  async function saveMemo() {
    setSaving(true);
    const result = await updateInquiry(item.id, { memo });
    setSaving(false);
    if (!result.ok) {
      showToast({ message: "메모를 저장하지 못했습니다", tone: "error" });
      return;
    }
    onChanged(result.data);
    showToast({ message: "메모를 저장했습니다", tone: "ok" });
  }

  async function markReplied() {
    setSaving(true);
    const result = await updateInquiry(item.id, { replied_at: true, is_read: true });
    setSaving(false);
    if (!result.ok) {
      showToast({ message: "상태를 바꾸지 못했습니다", tone: "error" });
      return;
    }
    onChanged(result.data);
    showToast({ message: "처리 완료로 표시했습니다", tone: "ok" });
  }

  const subject = encodeURIComponent(`[아폴론이머시브웍스] ${item.name} 님 문의에 답장드립니다`);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{item.name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {item.company || "회사 없음"} · {item.email}
            {item.phone ? ` · ${item.phone}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            href={`mailto:${item.email}?subject=${subject}`}
          >
            메일 쓰기
          </a>
          <PrimaryBtn disabled={saving || Boolean(item.replied_at)} onClick={() => void markReplied()}>
            답장함
          </PrimaryBtn>
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">받은 날짜</dt>
          <dd className="mt-0.5 text-slate-900">{formatDotDate(item.created_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">처리</dt>
          <dd className="mt-0.5 text-slate-900">
            {item.replied_at ? `완료 ${formatDotDate(item.replied_at)}` : item.is_read ? "미처리" : "안 읽음"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">예산</dt>
          <dd className="mt-0.5 text-slate-900">{budgetLabel(item.budget)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">일정</dt>
          <dd className="mt-0.5 text-slate-900">{timelineLabel(item.timeline)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-sm text-slate-500">내용</p>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-800">
          {item.message || "—"}
        </pre>
      </div>

      <label className="mt-5 block">
        <span className="mb-1 block text-sm font-medium text-slate-700">내부 메모</span>
        <p className="mb-2 text-xs text-slate-400">문의한 사람에게는 보이지 않습니다</p>
        <textarea
          className="min-h-[96px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          maxLength={2000}
        />
      </label>
      <div className="mt-3">
        <PrimaryBtn disabled={saving} onClick={() => void saveMemo()}>
          메모 저장
        </PrimaryBtn>
      </div>
    </div>
  );
}

function InboxTab() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<InquiryFilter>("all");
  const [data, setData] = useState<InquiryList | null>(null);
  const [selected, setSelected] = useState<InquiryItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await listInquiries({
      q: q.trim() || undefined,
      filter
    });
    if (result.ok) {
      setData(result.data);
      setSelected((current) => {
        if (!current) return current;
        return result.data.items.find((item) => item.id === current.id) ?? current;
      });
    } else {
      showToast({ message: "문의를 불러오지 못했습니다", tone: "error" });
    }
    setLoading(false);
  }, [q, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openRow(row: InquiryItem) {
    setSelected(row);
    if (row.is_read) return;
    const result = await updateInquiry(row.id, { is_read: true });
    if (!result.ok) return;
    setSelected(result.data);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="새 문의" value={data?.summary.unread ?? 0} />
        <SummaryCard label="이번 달" value={data?.summary.thisMonth ?? 0} />
        <SummaryCard label="미처리" value={data?.summary.pending ?? 0} />
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="이름 · 회사 · 이메일 · 내용"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value as InquiryFilter)}
        >
          {INQUIRY_FILTERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {selected ? (
        <InquiryDetail
          item={selected}
          onChanged={(row) => {
            setSelected(row);
            void load();
          }}
        />
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">보낸 사람</th>
              <th className="px-3 py-2 font-medium">회사</th>
              <th className="px-3 py-2 font-medium">내용</th>
              <th className="px-3 py-2 font-medium">받은 날짜</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => {
              const unread = !row.is_read;
              const active = selected?.id === row.id;
              return (
                <tr
                  key={row.id}
                  className={`cursor-pointer border-t border-slate-100 ${
                    active ? "bg-slate-50" : ""
                  }`}
                  onClick={() => void openRow(row)}
                >
                  <td className="px-3 py-2">
                    {unread ? (
                      <span className="block h-1.5 w-1.5 rounded-full bg-rose-600" aria-label="안 읽음" />
                    ) : null}
                  </td>
                  <td className={`px-3 py-2 text-slate-900 ${unread ? "font-semibold" : ""}`}>
                    {row.name}
                  </td>
                  <td className={`px-3 py-2 text-slate-600 ${unread ? "font-semibold" : ""}`}>
                    {row.company || "—"}
                  </td>
                  <td className={`max-w-xs truncate px-3 py-2 text-slate-600 ${unread ? "font-semibold" : ""}`}>
                    {messagePreview(row.message)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDotDate(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : data && data.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">해당하는 문의가 없습니다</p>
        ) : null}
      </div>
    </div>
  );
}

export function WebsiteContact() {
  const [tab, setTab] = useState<Tab>("inbox");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Let's Talk</h1>
        <p className="mt-1 text-sm text-slate-500">홈페이지로 들어온 문의를 봅니다. 답장은 메일 프로그램에서 합니다.</p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("inbox")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "inbox" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
          }`}
        >
          문의
        </button>
        <button
          type="button"
          onClick={() => setTab("page")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "page" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
          }`}
        >
          페이지 설정
        </button>
      </div>
      {tab === "inbox" ? <InboxTab /> : null}
      {tab === "page" ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center text-sm text-slate-400">
          페이지 설정은 준비 중입니다
        </div>
      ) : null}
    </div>
  );
}
