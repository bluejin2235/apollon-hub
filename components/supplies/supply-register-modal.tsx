"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSupply, updateSupply } from "@/lib/supplies/operations";
import {
  getSlotsForZone,
  getSupplyZones,
  zoneSelectLabel
} from "@/lib/supplies/locations";
import { uploadSupplyImages } from "@/lib/supplies/storage";
import type { ProfileLite, SupplyLocation, SupplyWithRelations } from "@/lib/supplies/types";
import {
  emptyComponentRow,
  parseComponents,
  serializeComponents,
  type ComponentRow
} from "@/lib/supplies/utils";
import { supabase } from "@/lib/supabase/client";

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  locations: SupplyLocation[];
  currentUserId: string;
  mode?: "create" | "edit";
  initialSupply?: SupplyWithRelations | null;
  managers?: ProfileLite[];
};

export function SupplyRegisterModal({
  open,
  onClose,
  onSaved,
  locations,
  currentUserId,
  mode = "create",
  initialSupply = null,
  managers = []
}: Props) {
  const isEdit = mode === "edit";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [zoneCode, setZoneCode] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [managerId, setManagerId] = useState("");
  const [description, setDescription] = useState("");
  const [componentRows, setComponentRows] = useState<ComponentRow[]>([emptyComponentRow()]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  const zones = useMemo(() => getSupplyZones(locations), [locations]);
  const slots = useMemo(
    () => (zoneCode ? getSlotsForZone(locations, zoneCode) : []),
    [locations, zoneCode]
  );

  useEffect(() => {
    if (!open) return;

    if (isEdit && initialSupply) {
      setName(initialSupply.name);
      setZoneCode(initialSupply.location?.zone_code ?? "");
      setLocationId(initialSupply.location_id ?? "");
      setQuantity(initialSupply.quantity);
      setManagerId(initialSupply.manager_id ?? "");
      setDescription(initialSupply.description ?? "");
      setComponentRows(parseComponents(initialSupply.components));
      setFiles([]);
      setPreviews([]);
      setError(null);
      setShowMap(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const firstZone = zones[0]?.zone_code ?? "";
    const firstSlots = firstZone ? getSlotsForZone(locations, firstZone) : [];
    setName("");
    setZoneCode(firstZone);
    setLocationId(firstSlots[0]?.id ?? "");
    setQuantity(1);
    setManagerId("");
    setDescription("");
    setComponentRows([emptyComponentRow()]);
    setFiles([]);
    setPreviews([]);
    setError(null);
    setShowMap(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, locations, zones, isEdit, initialSupply]);

  useEffect(() => {
    if (!zoneCode) return;
    const zoneSlots = getSlotsForZone(locations, zoneCode);
    if (zoneSlots.length === 0) {
      setLocationId("");
      return;
    }
    if (!zoneSlots.some((s) => s.id === locationId)) {
      setLocationId(zoneSlots[0].id);
    }
  }, [zoneCode, locations, locationId]);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const addComponentRowAfter = (index: number) => {
    setComponentRows((rows) => [...rows.slice(0, index + 1), emptyComponentRow(), ...rows.slice(index + 1)]);
  };

  const updateComponentRow = (index: number, patch: Partial<ComponentRow>) => {
    setComponentRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeComponentRow = (index: number) => {
    setComponentRows((rows) => (rows.length <= 1 ? [emptyComponentRow()] : rows.filter((_, i) => i !== index)));
  };

  const appendFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => [...prev, ...incoming]);
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("물품명을 입력해 주세요.");
      return;
    }
    if (!zoneCode || !locationId) {
      setError("보관 구역(대분류·세부 위치)을 선택해 주세요.");
      return;
    }
    if (!isEdit && files.length === 0) {
      setError("사진을 1장 이상 등록해 주세요.");
      return;
    }

    setSaving(true);
    setError(null);

    const componentsStr = serializeComponents(componentRows);

    if (isEdit) {
      if (!initialSupply) {
        setSaving(false);
        setError("비품 정보를 불러올 수 없습니다.");
        return;
      }

      const { error: updateErr } = await updateSupply({
        supplyId: initialSupply.id,
        name,
        locationId,
        quantity,
        managerId: managerId || null,
        description: description || null,
        components: componentsStr
      });

      setSaving(false);
      if (updateErr) {
        setError(updateErr);
        return;
      }

      onSaved();
      onClose();
      return;
    }

    const { id, error: createErr } = await createSupply({
      name,
      locationId,
      quantity,
      managerId: currentUserId,
      description: description || null,
      components: componentsStr,
      imagePaths: []
    });

    if (createErr || !id) {
      setSaving(false);
      setError(createErr ?? "등록 실패");
      return;
    }

    const { paths, error: upErr } = await uploadSupplyImages(id, files);
    if (upErr) {
      setSaving(false);
      setError(upErr);
      return;
    }

    const { error: imgUpdateErr } = await supabase.from("supplies").update({ image_paths: paths }).eq("id", id);

    setSaving(false);
    if (imgUpdateErr) {
      setError(imgUpdateErr.message);
      return;
    }

    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">{isEdit ? "비품 수정" : "비품 등록"}</h2>
        {!isEdit ? (
          <p className="mt-1 text-xs text-slate-500">비품 코드는 위치 기준 자동 생성됩니다. (예: A01_001)</p>
        ) : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <div>
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900"
              aria-expanded={showMap}
            >
              {showMap ? (
                <>
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                  위치 안내 접기
                </>
              ) : (
                <>
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                  📍 보관 위치 안내 보기
                </>
              )}
            </button>
            {showMap ? (
              <div className="my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/warehouse-map.png"
                  alt="창고 보관 위치 배치도"
                  className="h-auto w-full rounded-lg border border-slate-200"
                />
              </div>
            ) : null}
          </div>

          <div>
            <span className="text-sm font-medium text-slate-700">
              비품 보관위치 <span className="text-rose-600">*</span>
            </span>
            <div className="mt-1 grid grid-cols-2 gap-3">
              <select
                value={zoneCode}
                onChange={(e) => setZoneCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
                aria-label="대분류"
              >
                {zones.map((z) => (
                  <option key={z.zone_code} value={z.zone_code}>
                    {zoneSelectLabel(z)}
                  </option>
                ))}
              </select>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
                disabled={slots.length === 0}
                aria-label="세부 위치"
              >
                {slots.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.slot_code}
                    {loc.slot_label ? ` — ${loc.slot_label}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {isEdit ? (
              <p className="mt-1 text-xs text-rose-600">
                ⚠️ 위치를 변경하면 비품 코드가 새로 발급됩니다. 기존 QR 라벨을 제거하고 새 QR을 출력해 부착하세요.
              </p>
            ) : null}
          </div>

          <label className="block text-sm font-medium text-slate-700">
            물품명 <span className="text-rose-600">*</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </label>

          {isEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-slate-700">
                수량
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm font-medium text-slate-700">
                담당자
                <select
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <label className="block text-sm font-medium text-slate-700">
              수량
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="mt-1 w-full max-w-[8rem] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {!isEdit ? (
            <div>
              <span className="text-sm font-medium text-slate-700">
                사진 <span className="text-rose-600">*</span>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="mt-1 w-full text-sm"
                onChange={(e) => {
                  appendFiles(Array.from(e.target.files ?? []));
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              {previews.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {previews.map((url, index) => (
                    <div key={`${url}-${index}`} className="relative h-16 w-16 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full rounded-lg border object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFileAt(index)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs text-white shadow hover:bg-rose-600"
                        aria-label="사진 삭제"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="block text-sm font-medium text-slate-700">
            설명
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">구성품</span>
            <div className="mt-2 space-y-2">
              {componentRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateComponentRow(index, { name: e.target.value })}
                    placeholder="품명"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => updateComponentRow(index, { qty: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                    aria-label="개수"
                  />
                  <span className="shrink-0 text-xs text-slate-500">개</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => addComponentRowAfter(index)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-base font-medium text-slate-700 hover:bg-slate-50"
                      aria-label="구성품 행 추가"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeComponentRow(index)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-base font-medium text-slate-700 hover:bg-slate-50"
                      aria-label="구성품 행 삭제"
                    >
                      −
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "저장 중…" : isEdit ? "저장" : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
