"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type MemberRole = "슈퍼관리자" | "중간관리자" | "멤버";

type CategoryRow = {
  name: string;
  total: number;
  monthly: number;
  yearly: number;
  isVirtual: boolean;
};

type ServiceCategoryRow = {
  category: string;
  contract_type: string | null;
};

function aggregateCategories(rows: ServiceCategoryRow[]): CategoryRow[] {
  const map = new Map<string, { total: number; monthly: number; yearly: number }>();

  for (const row of rows) {
    const cat = row.category?.trim();
    if (!cat) continue;
    if (!map.has(cat)) {
      map.set(cat, { total: 0, monthly: 0, yearly: 0 });
    }
    const entry = map.get(cat)!;
    entry.total += 1;
    if (row.contract_type === "월 구독") entry.monthly += 1;
    if (row.contract_type === "년 구독") entry.yearly += 1;
  }

  return [...map.entries()]
    .map(([name, counts]) => ({ name, ...counts, isVirtual: false }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export default function LicenseCategoriesPage() {
  const [role, setRole] = useState<MemberRole | null>(null);
  const [dbCategories, setDbCategories] = useState<CategoryRow[]>([]);
  const [virtualCategories, setVirtualCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [inputName, setInputName] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = role === "슈퍼관리자" || role === "중간관리자";

  const loadCategories = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("services")
      .select("category, contract_type")
      .eq("is_hub_card", false)
      .not("category", "is", null);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    setDbCategories(aggregateCategories((data ?? []) as ServiceCategoryRow[]));
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError("");

      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();
        setRole((profile?.role as MemberRole | undefined) ?? null);
      }

      await loadCategories();
      setLoading(false);
    };
    void run();
  }, [loadCategories]);

  const categories = useMemo(() => {
    const merged = [...dbCategories];
    for (const name of virtualCategories) {
      if (!merged.some((row) => row.name === name)) {
        merged.push({ name, total: 0, monthly: 0, yearly: 0, isVirtual: true });
      }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [dbCategories, virtualCategories]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingName(null);
    setInputName("");
    setMessage("");
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (name: string) => {
    setModalMode("edit");
    setEditingName(name);
    setInputName(name);
    setMessage("");
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingName(null);
    setInputName("");
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) {
      setError("카테고리명을 입력해주세요.");
      return;
    }

    const duplicate = categories.some(
      (row) => row.name === trimmed && row.name !== editingName
    );
    if (duplicate) {
      setError("이미 존재하는 카테고리명입니다.");
      return;
    }

    setSaving(true);
    setError("");

    if (modalMode === "create") {
      setVirtualCategories((prev) =>
        prev.includes(trimmed) ? prev : [...prev, trimmed].sort((a, b) => a.localeCompare(b, "ko"))
      );
      setMessage(`"${trimmed}" 카테고리를 추가했습니다.`);
      setSaving(false);
      closeModal();
      return;
    }

    if (!editingName) {
      setSaving(false);
      return;
    }

    const target = categories.find((row) => row.name === editingName);
    if (target?.isVirtual || target?.total === 0) {
      setVirtualCategories((prev) =>
        prev.map((name) => (name === editingName ? trimmed : name)).sort((a, b) => a.localeCompare(b, "ko"))
      );
      setMessage(`카테고리명을 "${trimmed}"(으)로 변경했습니다.`);
      setSaving(false);
      closeModal();
      return;
    }

    const { error: updateError } = await supabase
      .from("services")
      .update({ category: trimmed })
      .eq("category", editingName)
      .eq("is_hub_card", false);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadCategories();
    setMessage(`카테고리 "${editingName}" → "${trimmed}"(으)로 수정했습니다.`);
    closeModal();
  };

  const handleDelete = async (row: CategoryRow) => {
    setMessage("");
    setError("");

    if (row.total > 0) {
      setError(`"${row.name}" 카테고리에 연결된 서비스가 ${row.total}개 있어 삭제할 수 없습니다.`);
      return;
    }

    if (row.isVirtual || virtualCategories.includes(row.name)) {
      setVirtualCategories((prev) => prev.filter((name) => name !== row.name));
      setMessage(`"${row.name}" 카테고리를 목록에서 제거했습니다.`);
      return;
    }

    setMessage(`"${row.name}" 카테고리를 목록에서 제거했습니다.`);
  };

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">카테고리 설정</h1>
          <p className="mt-1 text-sm text-slate-600">라이선스 서비스 카테고리를 관리합니다.</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="rounded-xl bg-apollon-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-apollon-400"
          >
            + 카테고리 추가
          </button>
        ) : null}
      </header>

      {message ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <th className="px-4 py-3 font-medium">카테고리명</th>
                <th className="px-4 py-3 text-right font-medium">전체 서비스 수</th>
                <th className="px-4 py-3 text-right font-medium">월 구독 수</th>
                <th className="px-4 py-3 text-right font-medium">년 구독 수</th>
                {canManage ? <th className="px-4 py-3 text-right font-medium">작업</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 5 : 4}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    등록된 카테고리가 없습니다.
                  </td>
                </tr>
              ) : (
                categories.map((row) => (
                  <tr key={row.name} className="text-slate-800">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.total}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.monthly}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.yearly}</td>
                    {canManage ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(row.name)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-500/45 px-4 py-8 backdrop-blur-[2px]">
          <div className="apollon-card w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {modalMode === "create" ? "카테고리 추가" : "카테고리 수정"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-slate-100"
              >
                닫기
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">카테고리명</label>
                <input
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  placeholder="예: 기획/공통"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:border-apollon-400 focus:outline-none focus:ring-2 focus:ring-apollon-500/40"
                />
              </div>

              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-800 transition hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-apollon-500 py-3 font-semibold text-white transition hover:bg-apollon-400 disabled:opacity-60"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
