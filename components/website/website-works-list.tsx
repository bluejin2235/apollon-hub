"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMeta, listWorks } from "@/lib/website/api";
import { fillBasic, fillBody, fillFaq, fillRelated, workTitle } from "@/lib/website/checks";
import type { WebsiteCategory, WorkListItem } from "@/lib/website/types";

type SortKey = "recent" | "title" | "year";

function mediaUrl(siteUrl: string, src: string | null): string | null {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) return src;
  const base = siteUrl.replace(/\/$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function dotClass(state: "ok" | "warn" | "empty") {
  if (state === "ok") return "bg-emerald-500";
  if (state === "warn") return "bg-amber-500";
  return "bg-slate-300";
}

function FillDots({ item }: { item: WorkListItem }) {
  const dots = [
    fillBasic(item.check),
    fillBody(item.check),
    fillFaq(item.check),
    fillRelated(item.check)
  ];
  return (
    <span className="inline-flex items-center gap-1" title="기본정보 · 본문 · FAQ · 연결">
      {dots.map((state, i) => (
        <i key={i} className={`inline-block h-2 w-2 rounded-full ${dotClass(state)}`} />
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: WorkListItem["status"] }) {
  const published = status === "published";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        published ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {published ? "공개" : "초안"}
    </span>
  );
}

export function WebsiteWorksList({ siteUrl }: { siteUrl: string }) {
  const [items, setItems] = useState<WorkListItem[]>([]);
  const [categories, setCategories] = useState<WebsiteCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | "draft" | "published">("all");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [works, meta] = await Promise.all([
        listWorks({ status: "all", limit: 100 }),
        getMeta()
      ]);
      if (cancelled) return;
      if (!works.ok) {
        setError(works.error + (works.details ? ` · ${JSON.stringify(works.details)}` : ""));
        setLoading(false);
        return;
      }
      setItems(works.data.items ?? []);
      if (meta.ok) setCategories(meta.data.workCategories ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.label?.ko || c.id);
    }
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    let rows = items;
    if (status !== "all") rows = rows.filter((row) => row.status === status);
    if (category !== "all") rows = rows.filter((row) => row.category_id === category);
    if (keyword) {
      rows = rows.filter((row) => {
        const title = `${row.title?.ko ?? ""} ${row.title?.en ?? ""} ${row.slug}`.toLowerCase();
        return title.includes(keyword);
      });
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy === "title") return workTitle(a).localeCompare(workTitle(b), "ko");
      if (sortBy === "year") return String(b.year ?? "").localeCompare(String(a.year ?? ""));
      return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
    });
    return copy;
  }, [items, q, category, status, sortBy]);

  const published = items.filter((row) => row.status === "published").length;
  const draft = items.length - published;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-bold text-slate-900" style={{ fontSize: "var(--fs-title)" }}>
            프로젝트 목록
          </h1>
          <p className="mt-1 text-slate-500" style={{ fontSize: "var(--fs-sub)" }}>
            전체 {items.length} · 공개 {published} · 초안 {draft}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-apollon-500 px-4 py-2 text-sm font-semibold text-white"
        >
          ＋ 새 프로젝트
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 · 클라이언트 검색"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="카테고리"
        >
          <option value="all">전체 카테고리</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label?.ko || c.id}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | "draft" | "published")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="상태"
        >
          <option value="all">상태</option>
          <option value="published">공개</option>
          <option value="draft">초안</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
          aria-label="정렬"
        >
          <option value="recent">최신순</option>
          <option value="title">제목순</option>
          <option value="year">연도순</option>
        </select>
      </div>

      {loading ? <p className="text-sm text-slate-500">불러오는 중...</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">프로젝트</th>
                  <th className="py-2 pr-3 font-medium">카테고리</th>
                  <th className="py-2 pr-3 font-medium">연도</th>
                  <th className="py-2 pr-3 font-medium">상태</th>
                  <th className="py-2 pr-3 font-medium">채움</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const thumb = mediaUrl(siteUrl, item.key_image);
                  return (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 pr-3">
                        <Link href={`/website/works/${item.id}`} className="flex items-center gap-3">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb}
                              alt=""
                              className="h-10 w-[71px] shrink-0 rounded object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-[71px] shrink-0 place-items-center rounded bg-slate-100 text-[10px] text-slate-400">
                              16:9
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-900">{workTitle(item)}</span>
                            <span className="block truncate text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
                              /works/{item.slug}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-slate-600">
                        {labelById.get(item.category_id) ?? item.category_id}
                      </td>
                      <td className="py-3 pr-3 text-slate-600">{item.year ?? "—"}</td>
                      <td className="py-3 pr-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="py-3 pr-3">
                        <FillDots item={item} />
                      </td>
                      <td className="py-3 text-slate-400">⋯</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {filtered.map((item) => {
              const thumb = mediaUrl(siteUrl, item.key_image);
              return (
                <li key={item.id}>
                  <Link
                    href={`/website/works/${item.id}`}
                    className="apollon-card flex gap-3 p-3"
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-16 w-[114px] shrink-0 rounded object-cover" />
                    ) : (
                      <span className="grid h-16 w-[114px] shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-400">
                        16:9
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-900">{workTitle(item)}</span>
                      <span className="mt-1 block text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
                        {labelById.get(item.category_id) ?? item.category_id} · {item.year ?? "—"}
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <StatusBadge status={item.status} />
                        <FillDots item={item} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500">조건에 맞는 프로젝트가 없습니다.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
