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
  /** 설정 시 해당 리뷰 수정 모드 (별점·키워드·댓글·사진) */
  initialReview?: Review | null;
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

function starTenthsFromReview(rv: Review): number {
  const raw = rv.star_rating;
  if (typeof raw === "number" && raw >= 2 && raw <= 10) return raw;
  return 4;
}

function revisitFromReview(rv: Review): RevisitIntent {
  if (rv.revisit_intent === "again" || rv.revisit_intent === "meh" || rv.revisit_intent === "never") {
    return rv.revisit_intent;
  }
  return "meh";
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

function IconSpinner(props: { className?: string }) {
  return (
    <svg
      className={`${props.className ?? ""} animate-spin`.trim()}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/** 업로드 진행 단계 — UI 텍스트/버튼 상태 분기에 사용 */
type UploadStage = "idle" | "uploading" | "saving";

export function ReviewWriteModal({
  open,
  onClose,
  restaurantId,
  restaurantName,
  profileId,
  onSaved,
  initialReview = null
}: Props) {
  const [starTenths, setStarTenths] = useState<number>(8);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [revisit, setRevisit] = useState<RevisitIntent>("again");
  const [existingPaths, setExistingPaths] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  /** 현재 업로드 중인 사진 번호 (1-based). uploadStage === "uploading" 일 때 유효. */
  const [uploadCurrent, setUploadCurrent] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [msg, setMsg] = useState("");

  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  useEffect(() => {
    return () => previewUrls.forEach((u) => URL.revokeObjectURL(u));
  }, [previewUrls]);

  const reset = useCallback(() => {
    setStarTenths(8);
    setKeywords([]);
    setComment("");
    setVisitDate(new Date().toISOString().slice(0, 10));
    setRevisit("again");
    setExistingPaths([]);
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
      return;
    }
    if (initialReview) {
      setStarTenths(starTenthsFromReview(initialReview));
      setKeywords([...(initialReview.keyword_tags ?? [])]);
      setComment(initialReview.comment ?? "");
      setVisitDate(
        initialReview.visit_date && initialReview.visit_date.length >= 10
          ? initialReview.visit_date.slice(0, 10)
          : new Date().toISOString().slice(0, 10)
      );
      setRevisit(revisitFromReview(initialReview));
      setExistingPaths((initialReview.image_paths ?? []).filter((p): p is string => Boolean(p?.trim())));
      setFiles([]);
      setMsg("");
    } else {
      reset();
    }
  }, [open, initialReview, reset]);

  const totalPhotoCount = existingPaths.length + files.length;

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const room = MAX_PHOTOS - existingPaths.length - prev.length;
      if (room <= 0) return prev;
      return [...prev, ...incoming.slice(0, room)];
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeExistingPath = (path: string) => {
    setExistingPaths((prev) => prev.filter((p) => p !== path));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return; // 모바일에서 중복 탭 방어
    setMsg("");
    setSaving(true);
    // 사진이 있으면 “업로드 중”, 없으면 곧장 “저장 중”
    const totalFiles = files.length;
    setUploadTotal(totalFiles);
    setUploadCurrent(0);
    setUploadStage(totalFiles > 0 ? "uploading" : "saving");
    const isEdit = Boolean(initialReview);
    if (isEdit && initialReview!.reviewer_id !== profileId) {
      setMsg("본인이 작성한 리뷰만 수정할 수 있습니다.");
      setUploadStage("idle");
      setUploadCurrent(0);
      setUploadTotal(0);
      setSaving(false);
      return;
    }

    try {
      console.log(`${REVIEW_DEBUG} submit START`, {
        restaurantId,
        profileId,
        isEdit,
        fileCount: files.length,
        existingCount: existingPaths.length,
        starTenths,
        keywordCount: keywords.length
      });

      const newPaths: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        // “(1/3)” 표기는 곧 업로드를 시작할 사진 번호 (1-based)
        setUploadCurrent(i + 1);
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const name = `${restaurantId}/${crypto.randomUUID()}.${ext}`;
        console.log(`${REVIEW_DEBUG} storage.upload attempt`, {
          bucket: BUCKET,
          path: name,
          fileName: f.name,
          size: f.size,
          contentType: f.type || null,
          index: i + 1,
          total: files.length
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
        newPaths.push(name);
      }

      console.log(`${REVIEW_DEBUG} all uploads done, paths (storage keys)`, newPaths);
      // 모든 사진 업로드 완료 → DB 저장 단계로 표시 전환
      setUploadStage("saving");

      const commentTrim = comment.slice(0, COMMENT_MAX).trim();
      const finalImagePaths = [...existingPaths, ...newPaths];

      if (isEdit) {
        const updatePayload = {
          star_rating: starTenths,
          keyword_tags: keywords,
          image_paths: finalImagePaths,
          revisit_intent: revisit,
          comment: commentTrim || null,
          visit_date: visitDate || null
        };

        console.log(`${REVIEW_DEBUG} reviews.update payload`, updatePayload, { id: initialReview!.id });

        const updateRes = await supabase
          .from("reviews")
          .update(updatePayload)
          .eq("id", initialReview!.id)
          .eq("reviewer_id", profileId)
          .select("*")
          .maybeSingle();

        console.log(`${REVIEW_DEBUG} reviews.update result`, {
          data: updateRes.data,
          error: updateRes.error
        });

        if (updateRes.error || !updateRes.data) {
          setMsg(updateRes.error?.message ?? "리뷰 수정에 실패했습니다.");
          console.error(`${REVIEW_DEBUG} reviews.update FAILED`, updateRes.error);
          for (const p of newPaths) {
            void supabase.storage.from(BUCKET).remove([p]);
          }
          return;
        }

        const originalPaths = (initialReview!.image_paths ?? []).filter((p): p is string => Boolean(p?.trim()));
        const removed = originalPaths.filter((p) => !finalImagePaths.includes(p));
        if (removed.length > 0) {
          void supabase.storage.from(BUCKET).remove(removed);
        }

        onSaved(updateRes.data as Review);
        handleClose();
        return;
      }

      const insertPayload = {
        restaurant_id: restaurantId,
        reviewer_id: profileId,
        star_rating: starTenths,
        keyword_tags: keywords,
        image_paths: finalImagePaths,
        revisit_intent: revisit,
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
        for (const p of newPaths) {
          void supabase.storage.from(BUCKET).remove([p]);
        }
        return;
      }

      const row = insertRes.data as Review;
      console.log(`${REVIEW_DEBUG} saved row image_paths`, row.image_paths);
      for (const p of newPaths) {
        console.log(`${REVIEW_DEBUG} public URL hint`, reviewImagePublicUrl(p));
      }

      onSaved(row);
      handleClose();
    } catch (err) {
      console.error(`${REVIEW_DEBUG} submit exception`, err);
      setMsg("처리 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
      setUploadStage("idle");
      setUploadCurrent(0);
      setUploadTotal(0);
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
                {initialReview ? "아슐랭 리뷰 수정" : "아슐랭 리뷰등록"} · {restaurantName}
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">
                {initialReview
                  ? "별점·키워드·댓글·사진을 수정할 수 있습니다."
                  : "이 맛집에 대한 솔직한 경험을 공유해주세요."}
              </p>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleClose}
              disabled={saving}
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
                {existingPaths.map((path) => (
                  <li
                    key={`ex-${path}`}
                    className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={reviewImagePublicUrl(path)} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeExistingPath(path)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-xs font-bold text-white hover:bg-black/70"
                      aria-label="기존 사진 삭제"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {files.map((_, idx) => (
                  <li key={`new-${idx}`} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
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
                {totalPhotoCount < MAX_PHOTOS ? (
                  <li>
                    <label
                      className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition ${
                        saving
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:border-blue-400 hover:bg-blue-50/40"
                      }`}
                    >
                      <IconCamera className="h-6 w-6 text-blue-500" />
                      <span className="px-1 text-center text-[11px] font-semibold text-blue-600 sm:text-xs">사진 추가</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={saving}
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
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleClose}
              disabled={saving}
            >
              이전
            </button>
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              className="inline-flex min-w-[8rem] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-400 disabled:opacity-90"
            >
              {saving ? <IconSpinner className="h-4 w-4 text-white" /> : null}
              {uploadStage === "uploading"
                ? `사진 업로드 중... (${uploadCurrent}/${uploadTotal})`
                : uploadStage === "saving"
                  ? "저장 중..."
                  : initialReview
                    ? "수정 완료"
                    : "등록하기"}
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
