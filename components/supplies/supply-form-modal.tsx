"use client";

import { FormEvent, useEffect, useState } from "react";
import { uploadSupplyImage } from "@/lib/supplies/operations";
import type { ProfileLite, Supply, SupplyItem } from "@/lib/supplies/types";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  managers: ProfileLite[];
  supply?: Supply | null;
  initialItems?: SupplyItem[];
};

export function SupplyFormModal({ open, onClose, onSaved, managers, supply, initialItems = [] }: Props) {
  const isEdit = Boolean(supply);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("A");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [managerId, setManagerId] = useState("");
  const [status, setStatus] = useState<Supply["status"]>("available");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [items, setItems] = useState<{ item_name: string; quantity: number }[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemQty, setNewItemQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (supply) {
      setCode(supply.code);
      setName(supply.name);
      setCategory(supply.category);
      setLocation(supply.location);
      setDescription(supply.description ?? "");
      setQuantity(supply.quantity);
      setManagerId(supply.manager_id ?? "");
      setStatus(supply.status);
      setItems(initialItems.map((i) => ({ item_name: i.item_name, quantity: i.quantity })));
    } else {
      setCode("");
      setName("");
      setCategory("A");
      setLocation("");
      setDescription("");
      setQuantity(1);
      setManagerId(managers[0]?.id ?? "");
      setStatus("available");
      setItems([]);
    }
    setImageFile(null);
    setError(null);
  }, [supply]);

  const addItem = () => {
    if (!newItemName.trim()) return;
    setItems((prev) => [...prev, { item_name: newItemName.trim(), quantity: newItemQty }]);
    setNewItemName("");
    setNewItemQty(1);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError("코드와 물품명은 필수입니다.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      category: category.trim(),
      location: location.trim(),
      description: description.trim() || null,
      quantity,
      manager_id: managerId || null,
      status
    };

    let supplyId = supply?.id;
    let saveError: string | null = null;

    if (isEdit && supplyId) {
      const { error: upErr } = await supabase.from("supplies").update(payload).eq("id", supplyId);
      if (upErr) {
        setSaving(false);
        setError(upErr.message);
        return;
      }
      await supabase.from("supply_items").delete().eq("supply_id", supplyId);
    } else {
      const { data, error: insErr } = await supabase
        .from("supplies")
        .insert({ ...payload, available_qty: quantity })
        .select("id")
        .single();
      if (insErr || !data) {
        setSaving(false);
        setError(insErr?.message ?? "등록 실패");
        return;
      }
      supplyId = data.id as string;
    }

    if (supplyId && items.length > 0) {
      await supabase.from("supply_items").insert(
        items.map((i) => ({
          supply_id: supplyId,
          item_name: i.item_name,
          quantity: i.quantity,
          status: "normal"
        }))
      );
    }

    if (supplyId && imageFile) {
      const { url, error: imgErr } = await uploadSupplyImage(supplyId, imageFile);
      if (imgErr) saveError = imgErr;
      else if (url) await supabase.from("supplies").update({ image_url: url }).eq("id", supplyId);
    }

    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onSaved();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">{isEdit ? "비품 수정" : "비품 등록"}</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              코드
              <input value={code} onChange={(e) => setCode(e.target.value)} disabled={isEdit} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              구역
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {["A", "B", "C", "D", "E", "F", "1", "2", "3", "4"].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            물품명
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            보관위치
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            설명
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              수량
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              담당자
              <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">—</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {isEdit ? (
            <label className="block text-sm font-medium text-slate-700">
              상태
              <select value={status} onChange={(e) => setStatus(e.target.value as Supply["status"])} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="available">대출가능</option>
                <option value="borrowed">대출중</option>
                <option value="maintenance">점검중</option>
              </select>
            </label>
          ) : null}
          <label className="block text-sm font-medium text-slate-700">
            사진
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-sm" />
          </label>

          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-800">구성품</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {items.map((it, idx) => (
                <li key={idx}>
                  {it.item_name} × {it.quantity}
                  <button type="button" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} className="ml-2 text-rose-600 text-xs">
                    삭제
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="구성품명" className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <input type="number" min={1} value={newItemQty} onChange={(e) => setNewItemQty(Number(e.target.value))} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={addItem} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">
                추가
              </button>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
              취소
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
