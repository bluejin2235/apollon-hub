import { Eye, Monitor } from "lucide-react";
import type { ReactNode } from "react";
import type { Loc } from "@/lib/website/work-detail";

import { GuideDocLink } from "@/components/website/guide-doc-link";

export function Guide({
  children,
  warn = false,
  docLink = false
}: {
  children: ReactNode;
  warn?: boolean;
  docLink?: boolean;
}) {
  return (
    <div
      className={`mt-2 border-l-2 py-1.5 pl-3 leading-relaxed text-slate-500 ${
        warn ? "border-amber-400 bg-amber-50" : "border-slate-200"
      }`}
      style={{ fontSize: "var(--fs-caption)" }}
    >
      {children}
      {docLink ? <GuideDocLink /> : null}
    </div>
  );
}

export function Sep() {
  return <span className="mx-1.5 text-slate-300">|</span>;
}

export function Req() {
  return <span className="ml-0.5 text-rose-600">*</span>;
}

export function AiBadge() {
  return (
    <span className="rounded bg-apollon-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-apollon-800">
      AI
    </span>
  );
}

export function CharPair({
  ko,
  en,
  koLimit,
  enLimit,
  koWarn,
  enWarn
}: {
  ko: number;
  en: number;
  koLimit: number;
  enLimit: number;
  koWarn: number;
  enWarn: number;
}) {
  return (
    <span className="ml-auto font-normal text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
      국문 <Count n={ko} warn={koWarn} max={koLimit} /> / {koLimit}
      {" · "}
      영문 <Count n={en} warn={enWarn} max={enLimit} /> / {enLimit}
    </span>
  );
}

export function CharKo({ n, limit, warn }: { n: number; limit: number; warn: number }) {
  return (
    <span className="ml-auto font-normal text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
      국문 <Count n={n} warn={warn} max={limit} /> / {limit}
    </span>
  );
}

function Count({ n, warn, max }: { n: number; warn: number; max: number }) {
  const color = n > max ? "text-red-600" : n > warn ? "text-amber-500" : "";
  return <span className={color}>{n}</span>;
}

export function FieldLabel({
  children,
  extra
}: {
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
      {children}
      {extra}
    </div>
  );
}

export function GroupTitle({
  children,
  note
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="mb-3 border-b border-slate-200 pb-1.5 text-xs font-bold tracking-wider text-slate-500">
      {children}
      {note ? <em className="ml-1 font-normal not-italic tracking-normal text-slate-400">— {note}</em> : null}
    </div>
  );
}

export function LangKo() {
  return (
    <span className="mr-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-bold text-slate-500">
      국문
    </span>
  );
}

export function LangEn() {
  return (
    <span className="mr-1.5 rounded bg-apollon-50 px-1 py-0.5 text-[10px] font-bold text-apollon-700">
      영문
    </span>
  );
}

const inputBase =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-gray-900 placeholder:text-slate-400";

export function TextInput({
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly,
  ai
}: {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  ai?: boolean;
}) {
  return (
    <input
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      onBlur={onBlur}
      className={`${inputBase} ${ai ? "border-apollon-200 bg-apollon-50" : "bg-white"} ${
        readOnly ? "text-slate-600" : ""
      }`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly,
  ai,
  rows = 3
}: {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  ai?: boolean;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      rows={rows}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      onBlur={onBlur}
      className={`${inputBase} min-h-[62px] resize-y ${ai ? "border-apollon-200 bg-apollon-50" : "bg-white"} ${
        readOnly ? "text-slate-600" : ""
      }`}
    />
  );
}

export function BilingualField({
  ko,
  en,
  onKo,
  onEn,
  onBlur,
  multiline,
  readOnly
}: {
  ko: string;
  en: string;
  onKo?: (value: string) => void;
  onEn?: (value: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  const Field = multiline ? TextArea : TextInput;
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
      <div className="relative">
        <div className="mb-1">
          <LangKo />
        </div>
        <Field value={ko} onChange={onKo} onBlur={onBlur} readOnly={readOnly} />
      </div>
      <div className="relative">
        <div className="mb-1 flex items-center gap-1">
          <LangEn />
          <AiBadge />
        </div>
        <Field value={en} onChange={onEn} onBlur={onBlur} readOnly={readOnly} ai />
      </div>
    </div>
  );
}

export function locField(loc: Loc, key: "ko" | "en", value: string): Loc {
  return { ...loc, [key]: value };
}

export function GhostBtn({
  children,
  disabled,
  onClick,
  type = "button"
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function PrimaryBtn({
  children,
  disabled,
  onClick,
  type = "button"
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg bg-apollon-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-apollon-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function SmallBtn({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function PreviewMiniBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-apollon-200 bg-apollon-50 px-2 py-0.5 text-[11px] font-semibold text-apollon-700 hover:bg-apollon-100"
    >
      <Eye className="h-3 w-3" />
      미리보기
    </button>
  );
}

export function PreviewBarBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Monitor className="h-4 w-4" />
      미리보기 ↗
    </button>
  );
}

export function AiBtn({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex items-center rounded-md border border-apollon-200 bg-apollon-50 px-2.5 py-1 text-xs font-semibold text-apollon-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function ToggleRow({
  on,
  onToggle,
  title,
  sub,
  disabled
}: {
  on: boolean;
  onToggle?: () => void;
  title: string;
  sub?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${
          on ? "bg-apollon-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            on ? "left-5" : "left-0.5"
          }`}
        />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        {sub ? (
          <span className="mt-0.5 block text-slate-500" style={{ fontSize: "var(--fs-caption)" }}>
            {sub}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function LunaCallout({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex gap-3 rounded-xl border border-apollon-200 bg-apollon-50 p-3.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-apollon-500 text-xs font-bold text-white">
        L
      </div>
      <div className="min-w-0 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

export function ThumbBox({
  label,
  src
}: {
  label: string;
  src?: string | null;
}) {
  return (
    <div className="flex h-[88px] max-w-md items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-400">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="px-3 text-center">{label || "없음"}</span>
      )}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-slate-400" style={{ fontSize: "var(--fs-caption)" }}>
      {children}
    </p>
  );
}
