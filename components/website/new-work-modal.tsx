"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createWork, getMeta } from "@/lib/website/api";
import type { ApiErr, WebsiteCategory } from "@/lib/website/types";
import { todayYmd } from "@/lib/website/work-detail";
import {
  textWidth,
  WORK_TITLE_KO_MAX,
  WORK_TITLE_KO_RECOMMEND
} from "@/lib/website/text-width";
import { CharWidthKo, FieldLabel, GhostBtn, PrimaryBtn, Req, TextInput } from "@/components/website/work-editor-ui";

type Props = {
  open: boolean;
  onClose: () => void;
};

function sanitizeSlug(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function suggestSlug(title: string) {
  if (!/[A-Za-z0-9]/.test(title)) return "";
  return sanitizeSlug(title);
}

function formatDetails(details: unknown) {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function isDuplicateSlug(result: ApiErr) {
  if (result.status === 409) return true;
  const blob = `${result.error} ${formatDetails(result.details)}`.toLowerCase();
  return blob.includes("23505") || (blob.includes("slug") && blob.includes("already"));
}

const WEBSITE_DOWN_MESSAGE =
  "홈페이지 개발 서버(localhost:3100)가 응답하지 않습니다.\n서버가 떠 있는지 확인한 뒤 다시 시도하세요.";

function isWebsiteDown(result: ApiErr) {
  return (
    result.error === "website_timeout" ||
    result.error === "website_unreachable" ||
    result.error === "network_error"
  );
}

export function NewWorkModal({ open, onClose }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setCategoryId("");
    setYear(String(new Date().getFullYear()));
    setError(null);
    setBusy(false);
    void getMeta().then((res) => {
      if (!res.ok) {
        setError(res.error + (res.details ? `\n${formatDetails(res.details)}` : ""));
        return;
      }
      setCategories(res.data.workCategories ?? []);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  function onTitleChange(value: string) {
    setTitle(value);
    if (!slugEdited) setSlug(suggestSlug(value));
  }

  function onSlugChange(value: string) {
    setSlugEdited(true);
    setSlug(sanitizeSlug(value));
  }

  async function submit() {
    const ko = title.trim();
    const nextSlug = sanitizeSlug(slug);
    if (!ko || !nextSlug || !categoryId || !year.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createWork({
        slug: nextSlug,
        category_id: categoryId,
        year: year.trim(),
        title: { ko, en: ko },
        summary: { ko: "작성 중입니다.", en: "" },
        key_image: "/works/placeholder-wide.svg",
        published_at: todayYmd()
      });
      if (!res.ok) {
        if (isWebsiteDown(res)) {
          setError(WEBSITE_DOWN_MESSAGE);
          return;
        }
        if (isDuplicateSlug(res)) {
          setError("이미 쓰고 있는 주소입니다");
          return;
        }
        if (res.status === 400) {
          setError(formatDetails(res.details) || res.error);
          return;
        }
        setError(res.error + (res.details ? `\n${formatDetails(res.details)}` : ""));
        return;
      }
      onClose();
      router.push(`/website/works/${res.data.id}?tab=basic`);
    } catch {
      setError(WEBSITE_DOWN_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const canSubmit = Boolean(title.trim() && sanitizeSlug(slug) && categoryId && year.trim()) && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10 sm:pt-16">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">새 프로젝트</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <FieldLabel
              extra={
                <CharWidthKo
                  n={textWidth(title)}
                  warn={WORK_TITLE_KO_RECOMMEND}
                  limit={WORK_TITLE_KO_MAX}
                />
              }
            >
              제목(국문)
              <Req />
            </FieldLabel>
            <TextInput value={title} onChange={onTitleChange} placeholder="44 이내 권장" />
          </div>

          <div>
            <FieldLabel>
              주소(slug)
              <Req />
            </FieldLabel>
            <TextInput
              value={slug}
              onChange={onSlugChange}
              placeholder="영문 소문자와 하이픈만. 예) lotte-duty-free-star-avenue"
            />
            <p className="mt-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
              apollonworks.com/works/{slug || "…"}
            </p>
          </div>

          <div>
            <FieldLabel>
              사업분야
              <Req />
            </FieldLabel>
            <div className="flex flex-col gap-1.5">
              {categories.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="new-work-category"
                    checked={categoryId === c.id}
                    onChange={() => setCategoryId(c.id)}
                  />
                  {c.label?.ko || c.id}
                </label>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>
              완공 연도
              <Req />
            </FieldLabel>
            <TextInput value={year} onChange={setYear} />
          </div>

          {error ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</pre>
          ) : null}
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          <p className="mb-3 text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
            만든 뒤 기본정보 탭에서 요약·대표 이미지를 채우면 공개할 수 있습니다.
          </p>
          <div className="flex justify-end gap-2">
            <GhostBtn onClick={onClose}>취소</GhostBtn>
            <PrimaryBtn disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? "만드는 중…" : "만들기"}
            </PrimaryBtn>
          </div>
        </div>
      </div>
    </div>
  );
}
