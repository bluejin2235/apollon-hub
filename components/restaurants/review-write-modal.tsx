"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Review } from "@/lib/restaurants/types";
import { REVIEW_KEYWORD_GROUPS, REVISIT_OPTIONS, type RevisitIntent } from "@/lib/restaurants/review-keywords";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  profileId: string;
  onSaved: (row: Review) => void;
};

const BUCKET = "review-images";

function toggle<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function ReviewWriteModal({ open, onClose, restaurantId, profileId, onSaved }: Props) {
  const [starTenths, setStarTenths] = useState(8);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [revisit, setRevisit] = useState<RevisitIntent>("again");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const starLabel = useMemo(() => (starTenths / 2).toFixed(1), [starTenths]);

  const reset = () => {
    setStarTenths(8);
    setKeywords([]);
    setComment("");
    setVisitDate(new Date().toISOString().slice(0, 10));
    setRevisit("again");
    setFiles([]);
    setMsg("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    try {
      const paths: string[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const name = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(name, f, {
          cacheControl: "3600",
          upsert: false,
          contentType: f.type || undefined
        });
        if (upErr) {
          setMsg(`이미지 업로드 실패: ${upErr.message}`);
          return;
        }
        paths.push(name);
      }

      const legacyRating = Math.min(5, Math.max(1, Math.round(starTenths / 2)));
      const { data: row, error } = await supabase
        .from("reviews")
        .insert({
          restaurant_id: restaurantId,
          reviewer_id: profileId,
          rating: legacyRating,
          star_rating: starTenths,
          keyword_tags: keywords,
          image_paths: paths,
          revisit_intent: revisit,
          revisit: revisit === "again",
          comment: comment.trim() || null,
          visit_date: visitDate || null
        })
        .select("*")
        .single();

      if (error || !row) {
        setMsg(error?.message ?? "리뷰 저장에 실패했습니다.");
        return;
      }
      onSaved(row as Review);
      handleClose();
    } catch (err) {
      console.error(err);
      setMsg("처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">리뷰 작성</h2>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={handleClose}>
            닫기
          </button>
        </div>

        <form className="mt-5 space-y-5" onSubmit={(e) => void submit(e)}>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">별점 (0.5점 단위)</p>
            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: 9 }, (_, i) => {
                const v = i + 2;
                const active = starTenths === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStarTenths(v)}
                    className={`min-w-[2.5rem] rounded px-2 py-1.5 text-xs font-semibold ${
                      active ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {(v / 2).toFixed(1)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-sm text-slate-600">선택: {starLabel} / 5</p>
          </div>

          {REVIEW_KEYWORD_GROUPS.map((g) => (
            <div key={g.id}>
              <p className="mb-2 text-sm font-medium text-slate-800">
                {g.emoji} {g.title}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.keywords.map((k) => {
                  const on = keywords.includes(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setKeywords((prev) => toggle(prev, k.id))}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">방문일</label>
            <input
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">텍스트 리뷰</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="솔직한 한 줄 평을 남겨주세요."
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">사진 (여러 장)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="w-full text-sm text-slate-600"
            />
            {files.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {files.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">재방문 의향</p>
            <div className="flex flex-wrap gap-2">
              {REVISIT_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setRevisit(o.id)}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    revisit === o.id ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {o.icon} {o.label}
                </button>
              ))}
            </div>
          </div>

          {msg ? <p className="text-sm text-rose-600">{msg}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={handleClose}>
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function reviewImagePublicUrl(path: string): string {
  return storagePublicUrl(BUCKET, path);
}
