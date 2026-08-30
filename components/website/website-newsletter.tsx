"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { showToast } from "@/components/website/toast";
import { deleteNewsletter, listNewsletter } from "@/lib/website/api";
import { formatDotDate } from "@/lib/website/career";
import type { NewsletterItem, NewsletterList } from "@/lib/website/contact";

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function downloadCsv(items: NewsletterItem[]) {
  const lines = [
    ["이메일", "신청일", "로케일"].join(","),
    ...items.map((row) =>
      [row.email, formatDotDate(row.created_at), row.locale]
        .map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`)
        .join(",")
    )
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const stamp = formatDotDate(new Date().toISOString()).replaceAll(".", "");
  const link = document.createElement("a");
  link.href = url;
  link.download = `newsletter-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function WebsiteNewsletter() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<NewsletterList | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<NewsletterItem | null>(null);

  const load = useCallback(async () => {
    const result = await listNewsletter({ q: q.trim() || undefined });
    if (result.ok) setData(result.data);
    else showToast({ message: "구독자를 불러오지 못했습니다", tone: "error" });
    setLoading(false);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const result = await deleteNewsletter(pendingDelete.id);
    if (!result.ok) {
      showToast({ message: "해지하지 못했습니다", tone: "error" });
      return;
    }
    showToast({ message: "구독을 해지했습니다", tone: "ok" });
    setPendingDelete(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">뉴스레터</h1>
        <p className="mt-1 text-sm text-slate-500">구독자 목록만 봅니다. 발송은 이 화면에서 하지 않습니다.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="전체 구독자" value={data?.summary.total ?? 0} />
        <SummaryCard label="이번 달 신규" value={data?.summary.thisMonth ?? 0} />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="이메일"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          disabled={!data || data.items.length === 0}
          onClick={() => data && downloadCsv(data.items)}
        >
          CSV 내려받기
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">이메일</th>
              <th className="px-3 py-2 font-medium">신청일</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-900">{row.email}</td>
                <td className="px-3 py-2 text-slate-600">{formatDotDate(row.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:text-rose-700"
                    onClick={() => setPendingDelete(row)}
                  >
                    해지
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : data && data.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">해당하는 구독자가 없습니다</p>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="구독을 해지할까요?"
        description={
          pendingDelete ? (
            <span>
              {pendingDelete.email} 을 목록에서 삭제합니다. 이 주소로는 더 이상 받지 않습니다.
            </span>
          ) : null
        }
        confirmText="해지"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
