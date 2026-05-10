"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Review } from "@/lib/restaurants/types";
import { REVIEW_KEYWORD_GROUPS, type RevisitIntent } from "@/lib/restaurants/review-keywords";
import { storagePublicUrl } from "@/lib/restaurants/storage-public-url";
import { supabase } from "@/lib/supabase/client";

type Props = {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  restaurantName: string;
  profileId: string;
  onSaved: (row: Review) => void;
};

const BUCKET = "review-images";
const COMMENT_MAX = 1000;
const MAX_PHOTOS = 5;

/** F12 콘솔 필터: Ashuleng review */
const REVIEW_DEBUG = "[Ashuleng review]";

/** star_rating DB: 2–10 (0.5★ 단위) */
const STAR_TENTHS_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function toggle<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function IconClose(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function IconCamera(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

export function ReviewWriteModal({ open, onClose, restaurantId, restaurantName, profileId, onSaved }: Props) {
  const [starTenths, setStarTenths] = useState<number>(8);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [visitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [revisit] = useState<RevisitIntent>("again");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  useEffect(() => {
    return () => previewUrls.forEach((u) => URL.revokeObjectURL(u));
  }, [previewUrls]);

  const reset = useCallback(() => {
    setStarTenths(8);
    setKeywords([]);
    setComment("");
    setFiles([]);
    setMsg("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const next = [...prev, ...incoming].slice(0, MAX_PHOTOS);
      return next;
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    try {
      console.log(`${REVIEW_DEBUG} submit START`, {
        restaurantId,
        profileId,
        fileCount: files.length,
        starTenths,
        keywordCount: keywords.length
      });

      const paths: string[] = [];
      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const name = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
        console.log(`${REVIEW_DEBUG} storage.upload attempt`, {
          bucket: BUCKET,
          path: name,
          fileName: f.name,
          size: f.size,
          contentType: f.type || null
        });

        const storageRes = await supabase.storage.from(BUCKET).upload(name, f, {
          cacheControl: "3600",
          upsert: false,
          contentType: f.type || undefined
        });

        console.log(`${REVIEW_DEBUG} storage.upload result`, {
          path: name,
          data: storageRes.data,
          error: storageRes.error
        });

        if (storageRes.error) {
          setMsg(`이미지 업로드 실패: ${storageRes.error.message}`);
          console.error(`${REVIEW_DEBUG} storage.upload FAILED`, storageRes.error);
          return;
        }
        paths.push(name);
      }

      console.log(`${REVIEW_DEBUG} all uploads done, paths (storage keys)`, paths);

      const legacyRating = Math.min(5, Math.max(1, Math.round(starTenths / 2)));
      const commentTrim = comment.slice(0, COMMENT_MAX).trim();

      const insertPayload = {
        restaurant_id: restaurantId,
        reviewer_id: profileId,
        rating: legacyRating,
        star_rating: starTenths,
        keyword_tags: keywords,
        image_paths: paths,
        revisit_intent: revisit,
        revisit: revisit === "again",
        comment: commentTrim || null,
        visit_date: visitDate || null
      };

      console.log(`${REVIEW_DEBUG} reviews.insert payload`, insertPayload);

      const insertRes = await supabase.from("reviews").insert(insertPayload).select("*").maybeSingle();

      console.log(`${REVIEW_DEBUG} reviews.insert result`, {
        data: insertRes.data,
        error: insertRes.error,
        status: insertRes.status,
        statusText: insertRes.statusText
      });

      if (insertRes.error || !insertRes.data) {
        setMsg(insertRes.error?.message ?? "리뷰 저장에 실패했습니다.");
        console.error(`${REVIEW_DEBUG} reviews.insert FAILED`, insertRes.error);
        for (const p of paths) {
          void supabase.storage.from(BUCKET).remove([p]);
        }
        return;
      }

      const row = insertRes.data as Review;
      console.log(`${REVIEW_DEBUG} saved row image_paths`, row.image_paths);
      for (const p of paths) {
        console.log(`${REVIEW_DEBUG} public URL hint`, reviewImagePublicUrl(p));
      }

      onSaved(row);
      handleClose();
    } catch (err) {
      console.error(`${REVIEW_DEBUG} submit exception`, err);
      setMsg("처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const tagBase =
    "rounded-lg border-2 px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-500/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="shrink-0 border-b border-slate-100 px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-snug text-slate-900 sm:text-xl">
                아슐랭 리뷰등록 · {restaurantName}
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">이 맛집에 대한 솔직한 경험을 공유해주세요.</p>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={handleClose}
              aria-label="닫기"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form className="min-h-0 flex-1 overflow-y-auto px-6 py-5" onSubmit={(e) => void submit(e)}>
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm font-bold text-slate-900">별점 (0.5점 단위)</p>
              <div className="flex flex-wrap gap-2">
                {STAR_TENTHS_OPTIONS.map((tenths) => {
                  const label = (tenths / 2).toFixed(1);
                  const active = starTenths === tenths;
                  return (
                    <button
                      key={tenths}
                      type="button"
                      onClick={() => setStarTenths(tenths)}
                      className={`min-w-[2.75rem] rounded-lg border px-2.5 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-orange-500 bg-orange-500 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5">
              {REVIEW_KEYWORD_GROUPS.map((g) => (
                <div key={g.id}>
                  <p className="mb-3 text-sm font-bold text-slate-900">
                    {g.emoji} {g.title}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {g.keywords.map((k) => {
                      const on = keywords.includes(k.id);
                      return (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => setKeywords((prev) => toggle(prev, k.id))}
                          className={
                            on
                              ? `${tagBase} border-blue-600 bg-white text-blue-600`
                              : `${tagBase} border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100`
                          }
                        >
                          {k.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-6">
              <label className="mb-2 block text-sm font-bold text-slate-900">리뷰댓글</label>
              <div className="relative">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                  rows={6}
                  maxLength={COMMENT_MAX}
                  className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 pb-8 text-sm text-gray-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="리뷰를 작성해주세요."
                />
                <span className="pointer-events-none absolute bottom-2 right-3 text-xs tabular-nums text-slate-400">
                  {comment.length.toLocaleString()} / {COMMENT_MAX.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-6">
              <label className="mb-1 block text-sm font-bold text-slate-900">리뷰사진</label>
              <p className="mb-3 text-xs text-slate-500">사진은 최대 {MAX_PHOTOS}장까지 등록할 수 있어요.</p>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                {files.map((_, idx) => (
                  <li key={idx} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrls[idx]} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-xs font-bold text-white hover:bg-black/70"
                      aria-label="사진 삭제"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {files.length < MAX_PHOTOS ? (
                  <li>
                    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-blue-400 hover:bg-blue-50/40">
                      <IconCamera className="h-6 w-6 text-blue-500" />
                      <span className="px-1 text-center text-[11px] font-semibold text-blue-600 sm:text-xs">사진 추가</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          {msg ? <p className="mt-4 text-sm text-rose-600">{msg}</p> : null}

          <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 bg-white pt-4">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={handleClose}
            >
              이전
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "등록하기"}
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
