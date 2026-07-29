"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  activeProfiles,
  formatCurrency,
  licenseCostSuffix,
  resolveUiContractType
} from "@/lib/licenses/calc";
import { getCategoryColorHex } from "@/lib/licenses/category-colors";
import {
  buildMemberLicenseCostView,
  partitionMemberLicenses,
  type MemberLicenseCostView
} from "@/lib/licenses/member-license";
import type { License, Profile } from "@/lib/licenses/types";
import { useKrwRates } from "@/lib/licenses/use-krw-rates";
import { supabase } from "@/lib/supabase/client";

function firstInitial(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t) return "?";
  const arr = Array.from(t);
  return (arr[0] ?? "?").toUpperCase();
}

function formatOriginalCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

function formatJoinDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

function IconMail({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function IconUserBadge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}

function IconExternalLink({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function LicenseRow({
  license,
  costView,
  mode
}: {
  license: License;
  costView: MemberLicenseCostView;
  mode: "direct" | "common";
}) {
  const b = costView.breakdown;
  const ui = resolveUiContractType(license);
  const suffix = licenseCostSuffix(ui);
  const category = (license.category ?? "").trim() || "카테고리 미분류";
  const iconColor = getCategoryColorHex(category);

  return (
    <li className="flex items-start justify-between gap-4 border-b border-slate-100 py-4 last:border-0">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: iconColor }}
        >
          {firstInitial(license.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/licenses/${license.id}`}
              className="inline-flex min-w-0 items-center gap-1 font-semibold text-slate-900 hover:text-violet-600"
            >
              <span className="truncate">{license.name}</span>
              <IconExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </Link>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{category}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${costView.contractBadgeClass}`}>
              {costView.contractLabel}
            </span>
            {mode === "common" ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700">공통</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 text-right">
        {b.isPerpetual ? (
          <p className="text-sm font-medium text-slate-600">영구 라이선스</p>
        ) : mode === "direct" ? (
          <>
            <p className="text-sm font-bold tabular-nums text-slate-900">
              {costView.directMonthlyKrw != null ? formatCurrency(costView.directMonthlyKrw) : "—"}
              {suffix ? <span className="font-semibold text-slate-500">{suffix}</span> : null}
            </p>
            {!b.isKrw && costView.directMonthlyKrw != null && b.fxRate != null ? (
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                {formatOriginalCurrency(b.perUnitMonthlyOrig, b.currency)} → {formatCurrency(costView.directMonthlyKrw)}
                {suffix}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm font-bold tabular-nums text-slate-900">
              {costView.commonShareMonthlyKrw != null ? formatCurrency(costView.commonShareMonthlyKrw) : "—"}
              <span className="font-semibold text-slate-500">/월</span>
            </p>
            {!b.isKrw && costView.commonShareMonthlyKrw != null && b.fxRate != null ? (
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                {formatOriginalCurrency(b.perUnitMonthlyOrig, b.currency)} →{" "}
                {formatCurrency(b.perUnitMonthlyKrw ?? 0)}
                /월
              </p>
            ) : null}
            <p className="mt-0.5 text-[11px] text-slate-400">÷ 전체 멤버 분배</p>
          </>
        )}
      </div>
    </li>
  );
}

export default function LicensesMemberDetailPage() {
  const params = useParams();
  const profileId = typeof params.profileId === "string" ? params.profileId : "";
  const rates = useKrwRates();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [allServices, setAllServices] = useState<License[]>([]);
  const [directServiceIds, setDirectServiceIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileId) return;
    const run = async () => {
      const [profileRes, profilesRes, servicesRes, usersRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", profileId).maybeSingle(),
        supabase
          .from("profiles")
          .select("id, email, name, department, role, status, created_at")
          .order("name", { ascending: true }),
        supabase.from("services").select("*").eq("is_hub_card", false),
        supabase.from("license_users").select("service_id").eq("profile_id", profileId)
      ]);

      setProfile((profileRes.data ?? null) as Profile | null);
      setAllProfiles((profilesRes.data ?? []) as Profile[]);
      setAllServices((servicesRes.data ?? []) as License[]);
      const ids = new Set<string>();
      for (const row of usersRes.data ?? []) {
        if (row.service_id) ids.add(row.service_id as string);
      }
      setDirectServiceIds(ids);
      setLoading(false);
    };
    void run();
  }, [profileId]);

  const memberCount = useMemo(() => activeProfiles(allProfiles).length, [allProfiles]);

  const { direct, common } = useMemo(
    () => partitionMemberLicenses(allServices, directServiceIds),
    [allServices, directServiceIds]
  );

  const directViews = useMemo(
    () => direct.map((l) => ({ license: l, costView: buildMemberLicenseCostView(l, rates, memberCount) })),
    [direct, rates, memberCount]
  );

  const commonViews = useMemo(
    () => common.map((l) => ({ license: l, costView: buildMemberLicenseCostView(l, rates, memberCount) })),
    [common, rates, memberCount]
  );

  const { directMonthlyTotal, commonMonthlyTotal, totalMonthly } = useMemo(() => {
    let directMonthlyTotal = 0;
    let commonMonthlyTotal = 0;
    for (const { costView } of directViews) {
      if (costView.directMonthlyKrw != null) directMonthlyTotal += costView.directMonthlyKrw;
    }
    for (const { costView } of commonViews) {
      if (costView.commonShareMonthlyKrw != null) commonMonthlyTotal += costView.commonShareMonthlyKrw;
    }
    return {
      directMonthlyTotal,
      commonMonthlyTotal,
      totalMonthly: directMonthlyTotal + commonMonthlyTotal
    };
  }, [directViews, commonViews]);

  const licenseInUseCount = direct.length + common.length;

  if (loading) {
    return <p className="text-slate-600">불러오는 중...</p>;
  }

  if (!profile) {
    return (
      <p className="text-slate-600">
        프로필을 찾을 수 없습니다.{" "}
        <Link href="/licenses/members" className="text-violet-600 hover:underline">
          목록
        </Link>
      </p>
    );
  }

  const roleLabel = profile.role || "멤버";

  return (
    <div className="space-y-8">
      <Link href="/licenses/members" className="text-sm font-medium text-violet-600 hover:underline">
        ← 멤버별
      </Link>

      {/* 헤더 */}
      <header className="flex flex-wrap items-start gap-5">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-violet-600 text-2xl font-bold text-white"
          aria-hidden
        >
          {firstInitial(profile.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{profile.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <IconMail className="h-4 w-4 text-slate-400" />
              {profile.email}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <IconUserBadge className="h-3.5 w-3.5" />
              {roleLabel}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 좌측 메인 */}
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            <div className="border-b border-slate-100 px-6 py-5">
              <h2 className="text-base font-semibold text-slate-900">이용중인 라이선스</h2>
              <p className="mt-0.5 text-sm text-slate-500">이 멤버에게 직접 할당된 라이선스</p>
            </div>
            {directViews.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">직접 할당된 라이선스가 없습니다.</p>
            ) : (
              <ul className="px-6">{directViews.map((row) => (
                <LicenseRow key={row.license.id} license={row.license} costView={row.costView} mode="direct" />
              ))}</ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
            <div className="border-b border-slate-100 px-6 py-5">
              <h2 className="text-base font-semibold text-slate-900">공통 라이선스</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                전체 멤버가 공유하는 라이선스 (비용은 멤버 수로 나눈 금액)
              </p>
            </div>
            {commonViews.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">공통 라이선스가 없습니다.</p>
            ) : (
              <ul className="px-6">{commonViews.map((row) => (
                <LicenseRow key={row.license.id} license={row.license} costView={row.costView} mode="common" />
              ))}</ul>
            )}
          </section>
        </div>

        {/* 우측 사이드 */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">정보</h2>
            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">부서</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{profile.department || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">가입일</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{formatJoinDate(profile.created_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">이용중인 라이선스</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{licenseInUseCount}개</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">월간 사용 비용</h2>
            <p className="mt-4 text-3xl font-bold tabular-nums text-slate-900">{formatCurrency(totalMonthly)}</p>
            <p className="mt-1 text-sm text-slate-500">영구 라이선스 제외, 월/연간 구독만 포함</p>
            <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">직접 할당</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatCurrency(directMonthlyTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">
                  공통{memberCount > 0 ? ` (1/${memberCount}인분)` : ""}
                </span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatCurrency(commonMonthlyTotal)}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
