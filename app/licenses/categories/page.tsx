"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { isFkRestrictError } from "@/lib/licenses/service-categories";
import { supabase } from "@/lib/supabase/client";

type MemberRole = "슈퍼관리자" | "중간관리자" | "멤버";

type CategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  total: number;
  monthly: number;
  yearly: number;
};

export default function LicenseCategoriesPage() {
  const [role, setRole] = useState<MemberRole | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [inputName, setInputName] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = role === "슈퍼관리자" || role === "중간관리자";

  const loadCategories = useCallback(async () => {
    const [catRes, svcRes] = await Promise.all([
      supabase
        .from("service_categories")
        .select("id, name, sort_order, is_active")
        .order("sort_order", { ascending: true }),
      supabase
        .from("services")
        .select("category_id, contract_type")
        .eq("is_hub_card", false)
        .not("category_id", "is", null)
    ]);

    if (catRes.error) {
      setError(catRes.error.message);
      return;
    }
    if (svcRes.error) {
      setError(svcRes.error.message);
      return;
    }

    const counts = new Map<string, { total: number; monthly: number; yearly: number }>();
    for (const row of svcRes.data ?? []) {
      const id = typeof row.category_id === "string" ? row.category_id : "";
      if (!id) continue;
      if (!counts.has(id)) counts.set(id, { total: 0, monthly: 0, yearly: 0 });
      const entry = counts.get(id)!;
      entry.total += 1;
      if (row.contract_type === "월 구독") entry.monthly += 1;
      if (row.contract_type === "년 구독") entry.yearly += 1;
    }

    setCategories(
      (catRes.data ?? []).map((row) => {
        const c = counts.get(row.id) ?? { total: 0, monthly: 0, yearly: 0 };
        return {
          id: row.id as string,
          name: String(row.name ?? ""),
          sort_order: Number(row.sort_order) || 0,
          is_active: row.is_active !== false,
          ...c
        };
      })
    );
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

  const openCreateModal = () => {
    setModalMode("create");
    setEditingId(null);
    setEditingName(null);
    setInputName("");
    setMessage("");
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (row: CategoryRow) => {
    setModalMode("edit");
    setEditingId(row.id);
    setEditingName(row.name);
    setInputName(row.name);
    setMessage("");
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
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
      (row) => row.name === trimmed && row.id !== editingId
    );
    if (duplicate) {
      setError("이미 존재하는 카테고리명입니다.");
      return;
    }

    setSaving(true);
    setError("");

    if (modalMode === "create") {
      const maxSort = categories.reduce((m, r) => Math.max(m, r.sort_order), 0);
      const { error: insertError } = await supabase.from("service_categories").insert({
        name: trimmed,
        sort_order: maxSort + 10,
        is_active: true
      });
      setSaving(false);
      if (insertError) {
        const msg = insertError.message.toLowerCase();
        if (insertError.code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
          setError("이미 존재하는 카테고리명입니다.");
        } else {
          setError(insertError.message);
        }
        return;
      }
      await loadCategories();
      setMessage(`"${trimmed}" 카테고리를 추가했습니다.`);
      closeModal();
      return;
    }

    if (!editingId) {
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("service_categories")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", editingId);

    setSaving(false);

    if (updateError) {
      const msg = updateError.message.toLowerCase();
      if (updateError.code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
        setError("이미 존재하는 카테고리명입니다.");
      } else {
        setError(updateError.message);
      }
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
      setError(
        `${row.total}개 서비스가 사용 중입니다. 먼저 해당 서비스의 카테고리를 변경하세요.`
      );
      return;
    }

    const { count, error: countError } = await supabase
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("category_id", row.id)
      .eq("is_hub_card", false);

    if (countError) {
      setError(countError.message);
      return;
    }

    const used = count ?? 0;
    if (used > 0) {
      setError(
        `${used}개 서비스가 사용 중입니다. 먼저 해당 서비스의 카테고리를 변경하세요.`
      );
      return;
    }

    const { error: deleteError } = await supabase
      .from("service_categories")
      .delete()
      .eq("id", row.id);

    if (deleteError) {
      if (isFkRestrictError(deleteError)) {
        setError(
          `서비스가 사용 중입니다. 먼저 해당 서비스의 카테고리를 변경하세요.`
        );
      } else {
        setError(deleteError.message);
      }
      return;
    }

    await loadCategories();
    setMessage(`"${row.name}" 카테고리를 삭제했습니다.`);
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
      {error && !modalOpen ? (
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
                  <tr key={row.id} className="text-slate-800">
                    <td className="px-4 py-3 font-medium">
                      {row.name}
                      {!row.is_active ? (
                        <span className="ml-2 text-xs font-normal text-slate-400">(비활성)</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.total}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.monthly}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.yearly}</td>
                    {canManage ? (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
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
