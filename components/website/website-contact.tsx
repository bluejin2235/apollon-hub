"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { showToast } from "@/components/website/toast";
import { PrimaryBtn } from "@/components/website/work-editor-ui";
import {
  getInquiry,
  getInquiryFiles,
  listInquiries,
  listMentionMembers,
  saveInquiryMemo,
  updateInquiry
} from "@/lib/website/api";
import { formatDotDate } from "@/lib/website/career";
import {
  INQUIRY_FILTERS,
  INQUIRY_STATUS_LABEL,
  budgetLabel,
  customerTextOf,
  fileSizeLabel,
  findInquiryFile,
  applyInquiryToList,
  inquiryDownloadUrl,
  inquiryListView,
  inquirySummaryText,
  mentionPickerText,
  inquiryFileKey,
  inquiryStatus,
  inquiryTitle,
  isLetsTalkInquiry,
  mentionSaveMessage,
  resolveNewMentions,
  timelineLabel,
  type InquiryFile,
  type InquiryFiles,
  type InquiryFilter,
  type InquiryItem,
  type InquiryList,
  type InquirySection,
  type InquiryStatus,
  type LoadState,
  type MentionMember
} from "@/lib/website/contact";

type Tab = "inbox" | "page";

const MEMO_MAX = 2000;

const STATUS_BADGE: Record<InquiryStatus, string> = {
  unread: "bg-rose-50 text-rose-700 ring-rose-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-slate-100 text-slate-600 ring-slate-200"
};

/** 목록 · 수정 응답에 없는 상세 값(제목 · 구역 · 본문)은 앞의 값을 지킨다 */
function mergeInquiry(prev: InquiryItem | null, next: InquiryItem): InquiryItem {
  if (!prev || prev.id !== next.id) return next;
  return {
    ...prev,
    ...next,
    title: next.title ?? prev.title,
    sections: next.sections ?? prev.sections,
    text: next.text ?? prev.text,
    receipt_no: next.receipt_no ?? prev.receipt_no
  };
}

/** 주소에 ?id= 를 남겨 링크로 같은 문의를 열 수 있게 한다 */
function syncUrlId(id: string | null) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("id", id);
    else url.searchParams.delete("id");
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // 주소를 못 바꿔도 화면은 그대로 쓴다
  }
}

function StatusBadge({ item }: { item: InquiryItem }) {
  const status = inquiryStatus(item);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_BADGE[status]}`}
    >
      {INQUIRY_STATUS_LABEL[status]}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  active,
  onClick
}: {
  label: string;
  /** 숫자, 또는 받기 전 · 실패 글(inquirySummaryText) */
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </>
  );
  if (!onClick) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-white px-4 py-3 text-left hover:border-slate-400 ${
        active ? "border-slate-900" : "border-slate-200"
      }`}
    >
      {body}
    </button>
  );
}

/** 메일과 같은 구역 제목: 글자 밑에 가는 검은 줄 */
function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="border-b border-black pb-2 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function SectionValue({ label, value }: { label: string; value: string }) {
  const text = value?.trim();
  if (!text) return <span className="text-slate-400">없음</span>;
  if (label === "이메일" && text.includes("@")) {
    return (
      <a className="text-slate-900 underline underline-offset-2" href={`mailto:${text}`}>
        {text}
      </a>
    );
  }
  if (label === "전화") {
    return (
      <a className="text-slate-900 underline underline-offset-2" href={`tel:${text.replace(/[^\d+]/g, "")}`}>
        {text}
      </a>
    );
  }
  return <>{text}</>;
}

function SectionRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl>
      {rows.map(([label, value], index) => (
        <div
          key={`${label}-${index}`}
          className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-[#ccc] py-2 text-sm"
        >
          <dt className="text-[#666]">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-slate-900">
            <SectionValue label={label} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InquirySections({ sections }: { sections: InquirySection[] }) {
  return (
    <>
      {sections.map((section) => (
        <SectionBlock key={section.title} title={section.title}>
          <SectionRows rows={section.rows} />
        </SectionBlock>
      ))}
    </>
  );
}

function CustomerText({ value }: { value: string | null | undefined }) {
  if (!value?.trim()) {
    return <p className="text-sm text-slate-400">고객이 따로 적은 내용이 없습니다</p>;
  }
  return (
    <p className="whitespace-pre-wrap break-words rounded-md bg-[#f5f5f5] px-4 py-3 text-sm leading-relaxed text-slate-900">
      {value}
    </p>
  );
}

/** Let's Talk 첨부: 누를 때마다 새 내려받기 주소(10분)를 받아 연다 */
function InquiryAttachments({ id }: { id: string }) {
  const [files, setFiles] = useState<InquiryFiles | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const result = await getInquiryFiles(id);
    if (result.ok) setFiles(result.data);
    else setFailed(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(file: InquiryFile, index: number) {
    const key = inquiryFileKey(file, index);
    setBusy(key);
    const result = await getInquiryFiles(id);
    setBusy(null);
    if (result.ok) setFiles(result.data);
    const found = result.ok
      ? findInquiryFile(result.data.items, { id: file.id, name: file.name, index })?.url
      : null;
    const url = found ? inquiryDownloadUrl(found, file.name) : null;
    if (!url) {
      showToast({
        message: result.ok
          ? `「${file.name}」 파일을 찾지 못했습니다. 홈페이지 저장소를 확인해 주세요`
          : "내려받기 주소를 받지 못했습니다. 잠시 뒤 다시 눌러 주세요",
        tone: "error",
        durationMs: 6000
      });
      return;
    }
    // 새 창을 열지 않고 지금 탭에서 주소를 연다. 주소에 download= 가 붙어 있어 화면은 그대로 두고 파일만 내려받는다.
    // 새 창이 아니라서 팝업 차단에 걸리지 않는다
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener";
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (failed) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-red-600">첨부 목록을 읽지 못했습니다</span>
        <button
          type="button"
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          onClick={() => void load()}
        >
          다시 읽기
        </button>
      </div>
    );
  }
  if (!files) return <p className="text-sm text-slate-400">첨부 확인 중…</p>;
  if (files.items.length === 0 && files.missing.length === 0) {
    return <p className="text-sm text-slate-400">고객이 올린 파일이 없습니다</p>;
  }
  return (
    <div className="space-y-2">
      {files.items.length > 0 ? (
        <ul>
          {files.items.map((file, index) => {
            const key = inquiryFileKey(file, index);
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 border-b border-[#ccc] py-2 text-sm"
              >
                <span className="min-w-0 truncate text-slate-900">
                  {file.name} <span className="text-slate-400">{fileSizeLabel(file.size)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy === key}
                  className="shrink-0 rounded-md border border-slate-900 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-900 hover:text-white disabled:opacity-50"
                  onClick={() => void download(file, index)}
                >
                  {busy === key ? "여는 중…" : "내려받기"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {files.missing.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
          <p className="font-medium">고객이 올리다 실패한 파일</p>
          <p className="mt-0.5 break-words">{files.missing.join(", ")}</p>
          <p className="mt-1 text-xs text-amber-700">필요하면 고객에게 메일로 다시 받아 주세요.</p>
        </div>
      ) : null}
    </div>
  );
}

/** 열린 문의의 상세(저장 메모 포함)를 받았는지 */
type DetailState = "loading" | "ready" | "failed";

/** 내부 메모 + @ 로 사람 부르기 */
function MemoBox({
  item,
  members,
  membersState,
  ready,
  onSaved
}: {
  item: InquiryItem;
  members: MentionMember[];
  membersState: LoadState;
  /** 상세에서 저장 메모를 받았는지 */
  ready: DetailState;
  onSaved: (row: InquiryItem) => void;
}) {
  const saved = item.memo ?? "";
  const [memo, setMemo] = useState(saved);
  // 목록 행으로 먼저 열면 저장 메모가 상세로 늦게 온다. 받기 전에는 칸과 저장을 잠그고, 받으면 저장 메모로 채운다
  // (빈 칸이나 옛 값을 보고 기존 메모를 덮어쓰지 않게, 코덱스 12·13차)
  // 처음 받은 순간 한 번만, 그리는 도중에 채운다(잠금이 풀린 화면이 빈 칸으로 먼저 보이지 않게, 코덱스 14차).
  // 같은 문의를 다시 눌러도 쓰던 글은 그대로 둔다. 칸의 글이 기준 저장본과 같으면(고치지 않았거나 되돌렸으면)
  // 새로 받은 저장본으로 맞춘다(남이 저장한 메모를 옛 값으로 덮지 않게, 코덱스 15·16차)
  const [filled, setFilled] = useState(ready === "ready");
  /** 지금 칸의 글이 어떤 저장본에서 시작했는지 */
  const [base, setBase] = useState(saved);
  if (ready === "ready" && !filled) {
    setFilled(true);
    setMemo(saved);
    setBase(saved);
  } else if (ready === "ready" && saved !== base) {
    if (memo === base) setMemo(saved);
    if (memo === base || memo === saved) setBase(saved);
  }
  const isReady = ready === "ready" && filled;
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  /** 마지막 저장 뒤 목록에서 고른 사람 id (같은 이름이 여럿이어도 고른 사람만 부른다) */
  const [picked, setPicked] = useState<string[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => {
    const result = resolveNewMentions({ previous: saved, next: memo, members, mentionIds: picked });
    const byId = new Map(members.map((member) => [member.id, member]));
    return {
      names: result.ids.map((id) => byId.get(id)?.name ?? "").filter(Boolean),
      ambiguous: result.ambiguous
    };
  }, [memo, saved, members, picked]);

  const options = useMemo(() => {
    if (query === null) return [];
    const q = query.trim();
    return members
      .filter((member) => !q || member.name.includes(q) || (member.team ?? "").includes(q))
      .slice(0, 8);
  }, [members, query]);

  function syncPicker(value: string, caret: number) {
    const match = /(^|\s)@([^\s@]{0,20})$/.exec(value.slice(0, caret));
    setQuery(match ? match[2] : null);
    setActive(0);
  }

  function pick(member: MentionMember) {
    if (saving || !isReady) return;
    const el = areaRef.current;
    const caret = el?.selectionStart ?? memo.length;
    const head = memo.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.name} `);
    const next = `${head}${memo.slice(caret)}`.slice(0, MEMO_MAX);
    setMemo(next);
    setPicked((ids) => (ids.includes(member.id) ? ids : [...ids, member.id]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery(null);
      return;
    }
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const member = options[active];
      if (member) pick(member);
    }
  }

  async function save() {
    setSaving(true);
    const sent = memo;
    const result = await saveInquiryMemo(item.id, sent, picked);
    setSaving(false);
    if (!result.ok) {
      showToast({
        message:
          result.error === "mention_lookup_failed"
            ? "부를 사람 목록을 읽지 못해 메모를 저장하지 않았습니다. 잠시 뒤 다시 눌러 주세요"
            : "메모를 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요",
        tone: "error",
        durationMs: 6000
      });
      return;
    }
    setPicked([]);
    onSaved(result.data.item);
    const { message, tone } = mentionSaveMessage(result.data);
    const long = (result.data.deliveries ?? []).length > 0 || (result.data.ambiguous ?? []).length > 0;
    showToast({ message, tone, durationMs: long ? 8000 : undefined });
  }

  const dirty = memo !== saved;

  return (
    <SectionBlock title="내부 메모">
      <p className="mb-2 text-xs text-slate-500">
        @로 사람을 고르면 그 사람에게 허브 알림과 메일이 갑니다. 문의한 고객에게는 보이지 않습니다.
      </p>
      {ready === "loading" ? <p className="mb-2 text-xs text-slate-400">저장된 메모를 불러오는 중입니다.</p> : null}
      {ready === "failed" ? (
        <p className="mb-2 text-xs text-red-600">저장된 메모를 불러오지 못했습니다. 목록에서 문의를 다시 눌러 주세요.</p>
      ) : null}
      <div className="relative">
        <textarea
          ref={areaRef}
          aria-label="내부 메모"
          className="min-h-[96px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="예: @이름 견적 범위 같이 봐 주세요"
          value={memo}
          disabled={!isReady || saving}
          maxLength={MEMO_MAX}
          onChange={(event) => {
            setMemo(event.target.value);
            syncPicker(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onClick={(event) =>
            syncPicker(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)
          }
          onBlur={() => setQuery(null)}
        />
        {query !== null ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {membersState === "error" ? (
              <p className="px-3 py-2 text-sm text-red-600">{mentionPickerText(membersState, members.length, 0)}</p>
            ) : options.length === 0 || membersState === "loading" ? (
              <p className="px-3 py-2 text-sm text-slate-400">
                {mentionPickerText(membersState, members.length, options.length)}
              </p>
            ) : (
              <ul role="listbox" aria-label="부를 사람">
                {options.map((member, index) => (
                  <li key={member.id} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                        index === active ? "bg-slate-100" : "hover:bg-slate-50"
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(member);
                      }}
                    >
                      <span className="font-medium text-slate-900">{member.name}</span>
                      <span className="text-xs text-slate-500">{member.team ?? "팀 없음"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PrimaryBtn disabled={saving || !dirty || !isReady} onClick={() => void save()}>
          {saving ? "저장 중…" : "메모 저장"}
        </PrimaryBtn>
        {preview.names.length > 0 ? (
          <span className="text-xs text-slate-600">
            저장하면 알림이 갈 사람: {preview.names.map((name) => `@${name}`).join(", ")}
          </span>
        ) : null}
        {preview.ambiguous.length > 0 ? (
          <span className="text-xs text-amber-700">
            같은 이름이 여럿이라 알림이 가지 않습니다:{" "}
            {preview.ambiguous.map((name) => `@${name}`).join(", ")}. 목록에서 골라 주세요
          </span>
        ) : null}
        {preview.names.length === 0 && preview.ambiguous.length === 0 && dirty ? (
          <span className="text-xs text-amber-700">저장하지 않은 메모가 있습니다</span>
        ) : null}
      </div>
    </SectionBlock>
  );
}

function InquiryDetail({
  item,
  members,
  membersState,
  memoReady,
  onChanged,
  onClose
}: {
  item: InquiryItem;
  members: MentionMember[];
  membersState: LoadState;
  memoReady: DetailState;
  onChanged: (row: InquiryItem, keepMemo?: boolean) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const status = inquiryStatus(item);
  const structured = Boolean(item.sections && item.sections.length > 0);

  async function setReplied(done: boolean) {
    setSaving(true);
    const result = await updateInquiry(
      item.id,
      done ? { replied_at: true, is_read: true } : { replied_at: null }
    );
    setSaving(false);
    if (!result.ok) {
      showToast({ message: "상태를 바꾸지 못했습니다", tone: "error" });
      return;
    }
    onChanged(result.data, true);
    showToast({ message: done ? "처리 완료로 옮겼습니다" : "미처리로 되돌렸습니다", tone: "ok" });
  }

  const subject = encodeURIComponent(`[아폴론이머시브웍스] ${item.name} 님 문의에 답장드립니다`);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge item={item} />
            <span className="text-xs text-slate-500">받은 날짜 {formatDotDate(item.created_at)}</span>
            {item.receipt_no ? (
              <span className="text-xs text-slate-400">접수 {item.receipt_no}</span>
            ) : null}
          </div>
          <h2 className="mt-2 break-words text-lg font-semibold text-slate-900">
            {inquiryTitle(item, 80)}
          </h2>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          onClick={onClose}
        >
          닫기
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-3">
        <a
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          href={`mailto:${item.email}?subject=${subject}`}
        >
          메일 쓰기
        </a>
        {status === "done" ? (
          <>
            <span className="text-sm text-slate-600">
              {item.replied_at ? `${formatDotDate(item.replied_at)} 처리 완료` : "처리 완료"}
            </span>
            <button
              type="button"
              disabled={saving}
              className="rounded-md px-2 py-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800 disabled:opacity-50"
              onClick={() => void setReplied(false)}
            >
              미처리로 되돌리기
            </button>
          </>
        ) : (
          <>
            <PrimaryBtn disabled={saving} onClick={() => void setReplied(true)}>
              답장 완료로 표시
            </PrimaryBtn>
            <span className="text-xs text-slate-500">메일로 답장한 뒤 눌러 주세요</span>
          </>
        )}
      </div>

      {structured ? (
        <>
          <InquirySections sections={item.sections ?? []} />
          <SectionBlock title="문의 내용">
            <CustomerText value={customerTextOf(item)} />
          </SectionBlock>
        </>
      ) : (
        <>
          <SectionBlock title="연락처">
            <SectionRows
              rows={[
                ["이름", item.name],
                ["회사", item.company ?? ""],
                ["이메일", item.email],
                ["전화", item.phone ?? ""],
                ["예산", item.budget ? budgetLabel(item.budget) : ""],
                ["일정", item.timeline ? timelineLabel(item.timeline) : ""]
              ]}
            />
          </SectionBlock>
          <SectionBlock title="문의 내용">
            <CustomerText value={item.message} />
          </SectionBlock>
        </>
      )}

      {isLetsTalkInquiry(item) ? (
        <SectionBlock title="첨부">
          <InquiryAttachments key={item.id} id={item.id} />
        </SectionBlock>
      ) : null}

      <MemoBox
        key={item.id}
        item={item}
        members={members}
        membersState={membersState}
        ready={memoReady}
        onSaved={onChanged}
      />
    </div>
  );
}

function InboxTab() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<InquiryFilter>("all");
  const [data, setData] = useState<InquiryList | null>(null);
  const [selected, setSelected] = useState<InquiryItem | null>(null);
  const [detailState, setDetailState] = useState<{ id: string; state: DetailState } | null>(null);
  /** 지금 검색 · 거르기 조건의 목록 상태 */
  const [listState, setListState] = useState<LoadState>("loading");
  /** 목록을 보이고 있는데 새로 고침이 실패했나. 알림 한 번(toast)으로 끝내지 않고 목록 위에 남긴다 */
  const [refreshFailed, setRefreshFailed] = useState(false);
  /** 지금 조건의 목록을 받아 보이고 있나(새로 고침 실패 때 목록을 둘지 가른다) */
  const listShown = useRef(false);
  /** 목록 요청 번호. 늦게 온 옛 요청의 응답이 최신 결과를 덮지 않게 마지막 번호의 응답만 쓴다 */
  const listSeq = useRef(0);
  /**
   * 지금 검색 · 거르기 조건. 목록 요청은 보내는 순간 이 값을 읽는다.
   * 읽음 표시 · 메모 저장 뒤 새로 고침이 그 일을 시작한 때의 옛 조건으로 받아 최신 목록을 덮지 않게 한다
   */
  const criteriaRef = useRef<{ q: string; filter: InquiryFilter }>({ q, filter });
  const [members, setMembers] = useState<MentionMember[]>([]);
  /** 사람 목록 상태. 빈 목록도 받은 것(ready)이라 길이로 짐작하지 않는다 */
  const [membersState, setMembersState] = useState<LoadState>("loading");
  const detailRef = useRef<HTMLDivElement>(null);
  const linkOpened = useRef(false);

  /**
   * 목록 받기. fresh=true(검색 · 거르기를 바꿈)면 옛 목록 · 요약을 지우고 「불러오는 중」으로 둔다.
   * fresh=false(메모 저장 · 읽음 뒤 새로 고침)면 지금 목록을 둔 채 받는다.
   */
  const load = useCallback(
    async (fresh = false) => {
      const seq = ++listSeq.current;
      if (fresh) {
        listShown.current = false;
        setData(null);
        setListState("loading");
      }
      const criteria = criteriaRef.current;
      let result: Awaited<ReturnType<typeof listInquiries>>;
      try {
        result = await listInquiries({ q: criteria.q.trim() || undefined, filter: criteria.filter });
      } catch {
        result = { ok: false, error: "network_error", status: 0 };
      }
      if (seq !== listSeq.current) return;
      if (result.ok) {
        const list = result.data;
        listShown.current = true;
        setData(list);
        setListState("ready");
        setRefreshFailed(false);
        setSelected((current) => {
          if (!current) return current;
          const row = list.items.find((item) => item.id === current.id);
          return row ? mergeInquiry(current, row) : current;
        });
        return;
      }
      showToast({ message: "문의를 불러오지 못했습니다", tone: "error" });
      // 새로 고침이 실패하면 보이던 목록은 두고 목록 위에 알림을 남긴다. 조건을 바꾼 뒤의 실패면 실패로 보인다
      if (fresh) {
        setRefreshFailed(false);
        setListState("error");
      } else {
        if (listShown.current) setRefreshFailed(true);
        else setListState("error");
      }
    },
    []
  );

  // 조건이 바뀌면 지금 조건을 먼저 적어 두고 새로 받는다
  useEffect(() => {
    criteriaRef.current = { q, filter };
    void load(true);
  }, [q, filter, load]);

  useEffect(() => {
    void listMentionMembers().then(
      (result) => {
        if (result.ok) {
          setMembers(result.data);
          setMembersState("ready");
        } else setMembersState("error");
      },
      () => setMembersState("error")
    );
  }, []);

  // 지금 열린 문의 id 와 그 요청. 다른 문의를 열거나 닫으면 앞 요청을 끊고, 늦게 온 응답은 버린다.
  const openIdRef = useRef<string | null>(null);
  const openAbortRef = useRef<AbortController | null>(null);

  /** 열린 문의와 같은 id 일 때만 상세를 바꾼다 */
  const applyIfOpen = useCallback((row: InquiryItem, keepMemo = false) => {
    if (openIdRef.current !== row.id) return;
    // 읽음 · 처리 상태 응답은 메모를 바꾸지 않는다(늦게 온 옛 메모가 방금 저장한 메모를 덮지 않게, 코덱스 18차)
    setSelected((current) =>
      current && current.id === row.id ? mergeInquiry(current, keepMemo ? { ...row, memo: current.memo } : row) : row
    );
  }, []);

  const openById = useCallback(
    async (id: string, fallback?: InquiryItem) => {
      openAbortRef.current?.abort();
      const controller = new AbortController();
      openAbortRef.current = controller;
      openIdRef.current = id;
      const isCurrent = () => openIdRef.current === id && !controller.signal.aborted;

      if (fallback) setSelected(fallback);
      setDetailState({ id, state: "loading" });
      syncUrlId(id);
      const detail = await getInquiry(id, controller.signal);
      if (!isCurrent()) return;
      if (!detail.ok) {
        setDetailState({ id, state: "failed" });
        if (!fallback) {
          showToast({ message: "링크의 문의를 찾지 못했습니다", tone: "error" });
          syncUrlId(null);
        }
        return;
      }
      const row = detail.data;
      applyIfOpen(row);
      setDetailState({ id, state: "ready" });
      if (row.is_read) return;
      const marked = await updateInquiry(id, { is_read: true }, controller.signal);
      if (!isCurrent() || !marked.ok) return;
      applyIfOpen(marked.data, true);
      // 읽음 저장이 됐으면 목록의 읽음 표시 · 안 읽은 수를 바로 바꾼다. 아래 새로 고침이 실패해도 옛 표시로 남지 않게
      setData((list) => applyInquiryToList(list, marked.data));
      await load();
    },
    [load, applyIfOpen]
  );

  // 화면을 떠나면 남은 요청을 끊는다
  useEffect(
    () => () => {
      openAbortRef.current?.abort();
    },
    []
  );

  // 메일 · 허브 알림 링크(?id=)로 들어오면 그 문의를 연다 (처음 한 번)
  useEffect(() => {
    if (linkOpened.current) return;
    linkOpened.current = true;
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) void openById(id);
  }, [openById]);

  function openRow(row: InquiryItem) {
    void openById(row.id, row);
    if (window.innerWidth < 1024) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  }

  function closeDetail() {
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    openIdRef.current = null;
    setSelected(null);
    syncUrlId(null);
  }

  const items = data?.items ?? [];
  const searching = q.trim().length > 0 || filter !== "all";
  const listView = inquiryListView(listState, items.length, searching);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="안 읽은 문의"
          value={inquirySummaryText(listState, data?.summary.unread)}
          active={filter === "unread"}
          onClick={() => setFilter(filter === "unread" ? "all" : "unread")}
        />
        <SummaryCard
          label="답장 기다리는 문의 (미처리)"
          value={inquirySummaryText(listState, data?.summary.pending)}
          active={filter === "pending"}
          onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
        />
        <SummaryCard label="이번 달 들어온 문의" value={inquirySummaryText(listState, data?.summary.thisMonth)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {INQUIRY_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                filter === item.id ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="이름 · 회사 · 이메일 · 내용으로 찾기"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div ref={detailRef} className="order-first lg:sticky lg:top-4 lg:order-last">
          {selected ? (
            <InquiryDetail
              item={selected}
              members={members}
              membersState={membersState}
              memoReady={detailState?.id === selected.id ? detailState.state : "ready"}
              onChanged={(row, keepMemo) => {
                applyIfOpen(row, keepMemo);
                setData((list) => applyInquiryToList(list, row));
                void load();
              }}
              onClose={closeDetail}
            />
          ) : (
            <div className="hidden rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center text-sm text-slate-400 lg:block">
              목록에서 문의를 누르면 여기에 내용이 열립니다
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {refreshFailed && listView !== "loading" && listView !== "error" ? (
            <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800" role="status">
              <span>목록을 새로 받지 못했습니다. 보이는 목록은 조금 전 것일 수 있어요.</span>
              <button
                type="button"
                className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-800 hover:bg-amber-100"
                onClick={() => void load()}
              >
                다시 불러오기
              </button>
            </div>
          ) : null}
          {listView === "items" ? (
            <ul>
              {items.map((row) => {
                const unread = !row.is_read;
                const active = selected?.id === row.id;
                return (
                  <li key={row.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openRow(row)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
                        active ? "bg-slate-50" : ""
                      }`}
                    >
                      <span
                        className={`mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full ${
                          unread ? "bg-rose-600" : "bg-transparent"
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm text-slate-900 ${
                            unread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {inquiryTitle(row)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {row.name}
                          {row.company ? ` · ${row.company}` : ""} · {formatDotDate(row.created_at)}
                        </span>
                      </span>
                      <StatusBadge item={row} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : listView === "loading" ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">불러오는 중…</p>
          ) : listView === "error" ? (
            <div className="px-4 py-10 text-center text-sm text-red-600">
              <p>문의를 불러오지 못했습니다</p>
              <button
                type="button"
                className="mt-2 rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => void load(true)}
              >
                다시 불러오기
              </button>
            </div>
          ) : listView === "empty-search" ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              <p>조건에 맞는 문의가 없습니다</p>
              <button
                type="button"
                className="mt-2 rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  setQ("");
                  setFilter("all");
                }}
              >
                조건 지우기
              </button>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-slate-400">아직 들어온 문의가 없습니다</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function WebsiteContact() {
  const [tab, setTab] = useState<Tab>("inbox");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Let’s Talk</h1>
        <p className="mt-1 text-sm text-slate-500">
          홈페이지로 들어온 문의를 봅니다. 답장은 메일 프로그램에서 하고, 보낸 뒤 「답장 완료로 표시」를 누릅니다.
        </p>
      </div>
      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab("inbox")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "inbox" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
          }`}
        >
          문의
        </button>
        <button
          type="button"
          onClick={() => setTab("page")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "page" ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"
          }`}
        >
          페이지 설정
        </button>
      </div>
      {tab === "inbox" ? <InboxTab /> : null}
      {tab === "page" ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-16 text-center text-sm text-slate-400">
          페이지 설정은 준비 중입니다
        </div>
      ) : null}
    </div>
  );
}
