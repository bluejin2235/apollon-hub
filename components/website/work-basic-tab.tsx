"use client";

import { useEffect, useId, useState } from "react";
import {
  addCredit,
  addFolder,
  deleteCredit,
  deleteFolder,
  reorderCredits,
  reorderFolders,
  updateCredit,
  updateFolder
} from "@/lib/website/api";
import type { WebsiteCategory } from "@/lib/website/types";
import type {
  WorkBasicDraft,
  WorkCredit,
  WorkDetail,
  WorkFolder
} from "@/lib/website/work-detail";
import { asLoc } from "@/lib/website/work-detail";
import { workFolderPrefix } from "@/lib/website/upload-path";
import {
  formatKeyImageEmptyHint,
  formatThumbLargeHint,
  formatThumbSmallHint,
  VIDEO_LABELS
} from "@/lib/website/spec";
import { ImageUploader } from "@/components/website/image-uploader";
import { RepeatList, type SaveResult } from "@/components/website/repeat-list";
import { TagPicker } from "@/components/website/tag-picker";
import { locField } from "@/components/website/work-editor-ui";
import { Alert, Field, FoldGroup } from "@/components/website/ui";
import "./ui/work-admin.css";

type Props = {
  draft: WorkBasicDraft;
  onChange: (patch: Partial<WorkBasicDraft>) => void;
  work: WorkDetail;
  categories: WebsiteCategory[];
  siteUrl: string;
  onReload: () => Promise<void>;
};

type PendingExtra = { key: string; name: string; path: string };

function toOrder<T extends { id: string }>(items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, i) => ({ id: item.id, sort: i }));
}

function failOf(error: string): SaveResult {
  return { ok: false, error };
}

function filled(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function withinLimit(value: string, limit: number) {
  const text = value.trim();
  return text.length > 0 && text.length <= limit;
}

function isPlaceholderKey(src: string) {
  return !src.trim() || /placeholder-wide/i.test(src);
}

function toneOf(done: number, total: number): "ok" | "warn" | "faint" {
  if (done <= 0) return "faint";
  if (done >= total) return "ok";
  return "warn";
}

function splitFolders(folders: WorkFolder[]) {
  const sorted = [...folders].sort((a, b) => a.sort - b.sort);
  const isProject = (item: WorkFolder) =>
    item.kind === "ko" || item.name.trim() === "프로젝트 폴더";
  const isVideo = (item: WorkFolder) =>
    item.kind === "en" || item.name.trim() === "영상 폴더";
  const project =
    sorted.find(isProject) ??
    sorted.find((item) => filled(item.path) && !isVideo(item)) ??
    null;
  const video = sorted.find((item) => isVideo(item) && item.id !== project?.id) ?? null;
  const extras = sorted.filter((item) => item.id !== project?.id && item.id !== video?.id);
  return { project, video, extras };
}

function AiBadge() {
  return (
    <button type="button" className="aib" disabled title="국문으로 영문 생성">
      AI
    </button>
  );
}

function Bi({
  ko,
  en,
  onKo,
  onEn,
  multiline,
  koPlaceholder,
  enPlaceholder
}: {
  ko: string;
  en: string;
  onKo: (v: string) => void;
  onEn: (v: string) => void;
  multiline?: boolean;
  koPlaceholder?: string;
  enPlaceholder?: string;
}) {
  return (
    <div className="two">
      {multiline ? (
        <textarea
          className="i"
          value={ko}
          placeholder={koPlaceholder}
          onChange={(e) => onKo(e.target.value)}
        />
      ) : (
        <input
          className="i"
          value={ko}
          placeholder={koPlaceholder}
          onChange={(e) => onKo(e.target.value)}
        />
      )}
      <div className="enw">
        {multiline ? (
          <textarea
            className="i"
            value={en}
            placeholder={enPlaceholder}
            onChange={(e) => onEn(e.target.value)}
          />
        ) : (
          <input
            className="i"
            value={en}
            placeholder={enPlaceholder}
            onChange={(e) => onEn(e.target.value)}
          />
        )}
        <AiBadge />
      </div>
    </div>
  );
}

function FolderKindRow({
  label,
  required,
  placeholder,
  folder,
  kind,
  sort,
  workId,
  onReload
}: {
  label: string;
  required?: boolean;
  placeholder: string;
  folder: WorkFolder | null;
  kind: "ko" | "en";
  sort: number;
  workId: string;
  onReload: () => Promise<void>;
}) {
  const [local, setLocal] = useState(folder?.path ?? "");
  const [error, setError] = useState<string | null>(null);
  const shown = folder?.name?.trim() || label;

  useEffect(() => {
    setLocal(folder?.path ?? "");
  }, [folder?.id, folder?.path]);

  async function commit() {
    const trimmed = local.trim();
    setError(null);
    if (folder) {
      if (trimmed === folder.path || !trimmed) return;
      const res = await updateFolder(workId, folder.id, { path: trimmed });
      if (!res.ok) {
        setError(res.error);
        setLocal(folder.path);
        return;
      }
      await onReload();
      return;
    }
    if (!trimmed) return;
    const res = await addFolder(workId, { kind, path: trimmed, name: label, sort });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function remove() {
    setError(null);
    if (!folder) {
      setLocal("");
      return;
    }
    const res = await deleteFolder(workId, folder.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLocal("");
    await onReload();
  }

  return (
    <>
      <div className="frow">
        <div>
          <b style={{ fontSize: 12 }}>{shown}</b>
          {required ? <span className="rq2"> *</span> : null}
        </div>
        <input
          className="i"
          value={local}
          placeholder={placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
        />
        <button type="button" className="ico" onClick={() => void remove()}>
          ✕
        </button>
      </div>
      {error ? (
        <p style={{ margin: "-2px 0 8px", fontSize: 11, color: "var(--err)" }}>{error}</p>
      ) : null}
    </>
  );
}

function ExtraFolderRow({
  name,
  path,
  onNameBlur,
  onPathBlur,
  onDelete,
  onMove,
  canMoveUp,
  canMoveDown,
  error
}: {
  name: string;
  path: string;
  onNameBlur: (name: string) => void;
  onPathBlur: (path: string) => void;
  onDelete: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  error?: string | null;
}) {
  const [localName, setLocalName] = useState(name);
  const [localPath, setLocalPath] = useState(path);

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  useEffect(() => {
    setLocalPath(path);
  }, [path]);

  return (
    <>
      <div className="frow">
        <input
          className="i"
          value={localName}
          placeholder="폴더 이름 (예: 도면 폴더)"
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={() => onNameBlur(localName)}
        />
        <input
          className="i"
          value={localPath}
          placeholder="경로"
          onChange={(e) => setLocalPath(e.target.value)}
          onBlur={() => onPathBlur(localPath)}
        />
        <div className="frow-acts">
          {onMove ? (
            <>
              <button
                type="button"
                className="ico"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="ico"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
              >
                ↓
              </button>
            </>
          ) : null}
          <button type="button" className="ico" onClick={onDelete}>
            ✕
          </button>
        </div>
      </div>
      {error ? (
        <p style={{ margin: "-2px 0 8px", fontSize: 11, color: "var(--err)" }}>{error}</p>
      ) : null}
    </>
  );
}

export function WorkBasicTab({ draft, onChange, work, categories, siteUrl, onReload }: Props) {
  const credits = [...(work.work_credits ?? [])].sort((a, b) => a.sort - b.sort);
  const folders = [...(work.work_folders ?? [])].sort((a, b) => a.sort - b.sort);
  const tags = [...(work.work_tags ?? [])].sort((a, b) => a.sort - b.sort);
  const uploadRoot = workFolderPrefix(draft.slug || work.slug, work.id);
  const { project, video, extras } = splitFolders(folders);
  const [editingCategory, setEditingCategory] = useState(false);
  const [pendingExtras, setPendingExtras] = useState<PendingExtra[]>([]);
  const [extraErrors, setExtraErrors] = useState<Record<string, string>>({});
  const pendingKey = useId();

  const categoryLabel =
    categories.find((item) => item.id === draft.category_id)?.label?.ko || draft.category_id || "—";
  const keyFilled = !isPlaceholderKey(draft.key_image);
  const titleDone =
    withinLimit(draft.title.ko, 22) && draft.title.en.length <= 46;
  const summaryDone =
    withinLimit(draft.summary.ko, 80) && draft.summary.en.length <= 155;
  const requiredDone = [
    titleDone,
    filled(draft.slug),
    filled(draft.category_id),
    filled(draft.year),
    keyFilled,
    filled(draft.key_image_alt.ko),
    summaryDone
  ].filter(Boolean).length;

  const locationFilled =
    filled(draft.location_country.ko) &&
    filled(draft.location_city.ko) &&
    filled(draft.location_address.ko);
  const subtitleDone =
    !filled(draft.subtitle.ko) ||
    (draft.subtitle.ko.length <= 30 && draft.subtitle.en.length <= 60);
  const infoDone = [
    filled(draft.subtitle.ko) && subtitleDone,
    filled(draft.client.ko),
    locationFilled,
    credits.length > 0
  ].filter(Boolean).length;

  const videoDone = [filled(draft.loop_video_lg), filled(draft.loop_video_sm)].filter(Boolean).length;
  const folderDone = [Boolean(project?.path.trim()), Boolean(video?.path.trim())].filter(Boolean).length;
  const tagTone: "ok" | "warn" | "faint" =
    tags.length >= 3 ? "ok" : tags.length > 0 ? "warn" : "faint";

  async function commitExtraName(id: string, nextName: string) {
    const trimmed = nextName.trim();
    const row = extras.find((item) => item.id === id);
    if (!row || trimmed === row.name) return;
    setExtraErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const res = await updateFolder(work.id, id, { name: trimmed });
    if (!res.ok) {
      setExtraErrors((prev) => ({ ...prev, [id]: res.error }));
      return;
    }
    await onReload();
  }

  async function commitExtraPath(id: string, nextPath: string) {
    const trimmed = nextPath.trim();
    const row = extras.find((item) => item.id === id);
    if (!row) return;
    setExtraErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (!trimmed || trimmed === row.path) return;
    const res = await updateFolder(work.id, id, { path: trimmed });
    if (!res.ok) {
      setExtraErrors((prev) => ({ ...prev, [id]: res.error }));
      return;
    }
    await onReload();
  }

  async function commitPending(item: PendingExtra, nextPath: string, nextName: string) {
    const trimmed = nextPath.trim();
    setExtraErrors((prev) => {
      const next = { ...prev };
      delete next[item.key];
      return next;
    });
    if (!trimmed) return;
    const extrasStart = (project ? 1 : 0) + (video ? 1 : 0);
    const res = await addFolder(work.id, {
      kind: "extra",
      path: trimmed,
      name: nextName.trim(),
      sort: extrasStart + extras.length
    });
    if (!res.ok) {
      setExtraErrors((prev) => ({ ...prev, [item.key]: res.error }));
      return;
    }
    setPendingExtras((prev) => prev.filter((row) => row.key !== item.key));
    await onReload();
  }

  async function deleteExtra(id: string) {
    const res = await deleteFolder(work.id, id);
    if (!res.ok) {
      setExtraErrors((prev) => ({ ...prev, [id]: res.error }));
      return;
    }
    await onReload();
  }

  async function moveExtra(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= extras.length) return;
    const next = [...extras];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const extrasStart = (project ? 1 : 0) + (video ? 1 : 0);
    const order = [
      ...(project ? [{ id: project.id, sort: 0 }] : []),
      ...(video ? [{ id: video.id, sort: project ? 1 : 0 }] : []),
      ...next.map((item, i) => ({ id: item.id, sort: extrasStart + i }))
    ];
    const res = await reorderFolders(work.id, order);
    if (!res.ok) {
      setExtraErrors((prev) => ({ ...prev, [moved.id]: res.error }));
      return;
    }
    await onReload();
  }

  return (
    <div className="wa">
      <div className="grp">
        <div className="gt">
          꼭 채워야 하는 것 <span className="c">{requiredDone} / 7 완료</span>
        </div>

        <Field
          label="제목"
          required
          guideAnchorId="text-length"
          counts={[
            { label: "국문", value: draft.title.ko.length, recommend: 11, limit: 22 },
            { label: "영문", value: draft.title.en.length, recommend: 23, limit: 46 }
          ]}
        >
          <Bi
            ko={draft.title.ko}
            en={draft.title.en}
            koPlaceholder="국문 제목"
            enPlaceholder="영문 제목"
            onKo={(v) => onChange({ title: locField(draft.title, "ko", v) })}
            onEn={(v) => onChange({ title: locField(draft.title, "en", v) })}
          />
          {draft.title.ko.length > 22 ? (
            <Alert tone="e">국문이 22자를 넘습니다. 목록 카드에서 세 줄이 되어 흐트러집니다.</Alert>
          ) : null}
        </Field>

        <Field
          label="주소"
          required
          guideLink
          tip={
            <>
              <b>영문 소문자와 하이픈만</b>
              <br />
              공개 후에 바꾸면 기존 검색 순위와 외부 링크가 끊깁니다.
            </>
          }
        >
          <div className="slugrow">
            <span className="pre">apollonworks.com/works/</span>
            <input
              className="i"
              value={draft.slug}
              onChange={(e) => onChange({ slug: e.target.value })}
            />
          </div>
        </Field>

        <div className="two">
          <Field label="사업분야" required>
            {editingCategory ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  className="i"
                  value={draft.category_id}
                  onChange={(e) => {
                    onChange({ category_id: e.target.value });
                    setEditingCategory(false);
                  }}
                >
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label?.ko || item.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn xs"
                  onClick={() => setEditingCategory(false)}
                >
                  완료
                </button>
              </div>
            ) : (
              <div className="ro">
                <span className="v">{categoryLabel}</span>
                <button
                  type="button"
                  className="btn xs"
                  onClick={() => setEditingCategory(true)}
                >
                  바꾸기
                </button>
              </div>
            )}
          </Field>
          <Field
            label="완공 연도"
            required
            guideLink
            tip="화면에 보이는 연도이자 목록 정렬 기준입니다."
          >
            <input
              className="i"
              value={draft.year}
              onChange={(e) => onChange({ year: e.target.value })}
              style={{ maxWidth: 140 }}
            />
          </Field>
        </div>

        <Field
          label="대표 이미지"
          required
          guideAnchorId="image-key"
        >
          <ImageUploader
            bucket="works"
            folder={`${uploadRoot}/key`}
            accept="image"
            multiple={false}
            kind="key"
            appearance="filecard"
            siteUrl={siteUrl}
            value={keyFilled ? draft.key_image : null}
            emptyHint={formatKeyImageEmptyHint()}
            onUploaded={(files) => {
              const first = files[0];
              if (first) {
                onChange({
                  key_image: first.src,
                  key_image_width: first.width,
                  key_image_height: first.height
                });
              }
            }}
            onClear={() =>
              onChange({ key_image: "", key_image_width: null, key_image_height: null })
            }
          />
        </Field>

        <Field
          label="대체 텍스트"
          required
          counts={[{ label: "국문", value: draft.key_image_alt.ko.length, limit: 40 }]}
        >
          <Bi
            ko={draft.key_image_alt.ko}
            en={draft.key_image_alt.en}
            onKo={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "ko", v) })}
            onEn={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "en", v) })}
          />
        </Field>

        <Field
          label="한 줄 요약"
          required
          guideAnchorId="text-length"
          counts={[
            { label: "국문", value: draft.summary.ko.length, recommend: 60, limit: 80 },
            { label: "영문", value: draft.summary.en.length, recommend: 120, limit: 155 }
          ]}
        >
          <Bi
            ko={draft.summary.ko}
            en={draft.summary.en}
            multiline
            onKo={(v) => onChange({ summary: locField(draft.summary, "ko", v) })}
            onEn={(v) => onChange({ summary: locField(draft.summary, "en", v) })}
          />
        </Field>
      </div>

      <FoldGroup
        title="프로젝트 정보"
        summary="부제 · 클라이언트 · 위치 · 크레딧"
        filled={infoDone}
        total={4}
        countTone={toneOf(infoDone, 4)}
      >
        <Field
          label="부제"
          guideLink
          counts={[
            { label: "국문", value: draft.subtitle.ko.length, limit: 30 },
            { label: "영문", value: draft.subtitle.en.length, limit: 60 }
          ]}
          tip={
            <>
              상세 페이지 제목 아래 한 줄. 장소나 클라이언트를 적습니다.
              <br />
              <span className="ex">화면 자리는 훈희 이사 디자인 확정 대기 중입니다.</span>
            </>
          }
        >
          <Bi
            ko={draft.subtitle.ko}
            en={draft.subtitle.en}
            onKo={(v) => onChange({ subtitle: locField(draft.subtitle, "ko", v) })}
            onEn={(v) => onChange({ subtitle: locField(draft.subtitle, "en", v) })}
          />
        </Field>

        <Field label="클라이언트">
          <Bi
            ko={draft.client.ko}
            en={draft.client.en}
            onKo={(v) => onChange({ client: locField(draft.client, "ko", v) })}
            onEn={(v) => onChange({ client: locField(draft.client, "en", v) })}
          />
        </Field>

        <Field
          label="위치"
          guideLink
          tip={
            <>
              <b>국가 · 도시 · 주소 순서</b>
              <br />
              구조화 데이터로 나가므로 실제 행정 주소를 씁니다. 건물 이름만 쓰지 마세요.
            </>
          }
        >
          <Bi
            ko={draft.location_country.ko}
            en={draft.location_country.en}
            koPlaceholder="국가"
            onKo={(v) =>
              onChange({ location_country: locField(draft.location_country, "ko", v) })
            }
            onEn={(v) =>
              onChange({ location_country: locField(draft.location_country, "en", v) })
            }
          />
          <Bi
            ko={draft.location_city.ko}
            en={draft.location_city.en}
            koPlaceholder="도시"
            onKo={(v) =>
              onChange({ location_city: locField(draft.location_city, "ko", v) })
            }
            onEn={(v) =>
              onChange({ location_city: locField(draft.location_city, "en", v) })
            }
          />
          <input
            className="i"
            value={draft.location_address.ko}
            placeholder="주소"
            onChange={(e) =>
              onChange({
                location_address: locField(draft.location_address, "ko", e.target.value)
              })
            }
          />
        </Field>

        <Field
          label="참여 크레딧"
          aside={`${credits.length}개`}
          guideLink
          tip={
            <>
              <b>역할은 영문, 회사·사람 이름은 있는 그대로</b>
              <br />
              한 줄에 몰아 쓰면 검색엔진이 전부 「저자 이름」으로 잘못 읽습니다.
              <br />
              <span className="ex">
                Developer · Project Management · Architect · Media Architecture Design · Client
              </span>
            </>
          }
        >
          <RepeatList
            variant="boxed"
            items={credits}
            addLabel="＋ 크레딧 추가"
            onAdd={async () => {
              const res = await addCredit(work.id, {
                role: "Role",
                name: { ko: "이름", en: "" },
                sort: credits.length
              });
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            onUpdate={async (item: WorkCredit) => {
              const name = asLoc(item.name);
              const res = await updateCredit(work.id, item.id, { role: item.role, name });
              return res.ok ? { ok: true } : failOf(res.error);
            }}
            onDelete={async (item: WorkCredit) => {
              const res = await deleteCredit(work.id, item.id);
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            onReorder={async (from, to) => {
              const res = await reorderCredits(work.id, toOrder(credits, from, to));
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            renderFields={(item, onRowChange) => {
              const name = asLoc(item.name);
              return (
                <>
                  <input
                    className="i"
                    value={item.role}
                    placeholder="역할 (영문)"
                    onChange={(e) => onRowChange({ role: e.target.value })}
                  />
                  <input
                    className="i"
                    value={name.ko}
                    placeholder="회사·사람 이름"
                    onChange={(e) => onRowChange({ name: locField(name, "ko", e.target.value) })}
                  />
                </>
              );
            }}
          />
        </Field>
      </FoldGroup>

      <FoldGroup
        title="배경 영상"
        guideAnchorId="video-loop"
        summary="목록 카드에서 마우스를 올리면 도는 짧은 영상"
        filled={videoDone}
        total={2}
        countTone={toneOf(videoDone, 2)}
      >
        <div className="two">
          <Field label={VIDEO_LABELS.thumbLarge}>
            <ImageUploader
              bucket="works"
              folder={`${uploadRoot}/loop`}
              accept="video"
              multiple={false}
              kind="loop-lg"
              appearance="filecard"
              siteUrl={siteUrl}
              value={draft.loop_video_lg || null}
              emptyHint={formatThumbLargeHint()}
              onUploaded={(files) => {
                const first = files[0];
                if (first) onChange({ loop_video_lg: first.src });
              }}
              onClear={() => onChange({ loop_video_lg: "" })}
            />
          </Field>
          <Field label={VIDEO_LABELS.thumbSmall}>
            <ImageUploader
              bucket="works"
              folder={`${uploadRoot}/loop`}
              accept="video"
              multiple={false}
              kind="loop-sm"
              appearance="filecard"
              siteUrl={siteUrl}
              value={draft.loop_video_sm || null}
              emptyHint={formatThumbSmallHint()}
              onUploaded={(files) => {
                const first = files[0];
                if (first) onChange({ loop_video_sm: first.src });
              }}
              onClear={() => onChange({ loop_video_sm: "" })}
            />
          </Field>
        </div>
        <div style={{ marginTop: 11 }}>
          <Alert tone="i">
            <b>왜 두 벌인가</b> — 목록 한 화면에 큰 것 1개와 작은 것 8개가 함께 깔립니다. 큰 파일
            하나로 돌려쓰면 13MB 가 나가지만, 나눠 쓰면 5MB 로 줄어듭니다. 프리미어에서 같은 시퀀스를
            해상도만 바꿔 두 번 내보내면 됩니다.
          </Alert>
        </div>
      </FoldGroup>

      <FoldGroup
        title="태그"
        summary="워크 목록에서 필터로 쓰입니다"
        count={`${tags.length}개`}
        countTone={tagTone}
      >
        <Field
          label="태그"
          guideLink
          tip={
            <>
              <b>3~6개 · 카테고리로 나눌 수 없는 갈래</b>
              <br />
              워크 목록 상단의 해시태그 필터에 그대로 나옵니다. 태그를 누르면 같은 태그의 워크가
              모입니다.
              <br />
              <b>여러 프로젝트가 같은 태그를 공유해야 의미가 있습니다.</b> 이 워크에만 해당하는 말은
              태그가 아닙니다.
              <ul>
                <li>좋은 예 — 면세점 · K-POP · 미디어 파사드 · 리조트</li>
                <li>나쁜 예 — 일평균방문객16000명 · 2024년1월착수 · 김대리담당</li>
              </ul>
            </>
          }
        >
          <TagPicker
            workId={work.id}
            selectedIds={tags.map((t) => t.tag_id)}
            onReload={onReload}
          />
        </Field>
      </FoldGroup>

      <FoldGroup
        title="내부 연결"
        summary="Work서버 폴더 · 외부에 노출되지 않습니다"
        filled={folderDone}
        total={2}
        countTone={toneOf(folderDone, 2)}
      >
        <FolderKindRow
          label="프로젝트 폴더"
          required
          placeholder="T:\..."
          folder={project}
          kind="ko"
          sort={0}
          workId={work.id}
          onReload={onReload}
        />
        <FolderKindRow
          label="영상 폴더"
          placeholder="P:\... (없으면 비워둡니다)"
          folder={video}
          kind="en"
          sort={project ? 1 : 0}
          workId={work.id}
          onReload={onReload}
        />
        {extras.map((item, index) => (
          <ExtraFolderRow
            key={item.id}
            name={item.name}
            path={item.path}
            error={extraErrors[item.id]}
            canMoveUp={index > 0}
            canMoveDown={index < extras.length - 1}
            onNameBlur={(value) => void commitExtraName(item.id, value)}
            onPathBlur={(nextPath) => void commitExtraPath(item.id, nextPath)}
            onDelete={() => void deleteExtra(item.id)}
            onMove={(dir) => void moveExtra(index, dir)}
          />
        ))}
        {pendingExtras.map((item) => (
          <ExtraFolderRow
            key={item.key}
            name={item.name}
            path={item.path}
            error={extraErrors[item.key]}
            onNameBlur={(value) =>
              setPendingExtras((prev) =>
                prev.map((row) => (row.key === item.key ? { ...row, name: value } : row))
              )
            }
            onPathBlur={(nextPath) => {
              const name =
                pendingExtras.find((row) => row.key === item.key)?.name ?? item.name;
              setPendingExtras((prev) =>
                prev.map((row) =>
                  row.key === item.key ? { ...row, path: nextPath, name } : row
                )
              );
              void commitPending({ ...item, name, path: nextPath }, nextPath, name);
            }}
            onDelete={() => setPendingExtras((prev) => prev.filter((row) => row.key !== item.key))}
          />
        ))}
        <button
          type="button"
          className="btn sm"
          style={{ marginTop: 4 }}
          onClick={() =>
            setPendingExtras((prev) => [
              ...prev,
              { key: `${pendingKey}-${prev.length}-${Date.now()}`, name: "", path: "" }
            ])
          }
        >
          ＋ 폴더 추가
        </button>
        <div style={{ marginTop: 10 }}>
          <Alert tone="i">
            루나에게 「스타애비뉴 원본 어디 있어?」 라고 물으면 이 경로를 알려줍니다. 홈페이지에는
            나가지 않습니다.
          </Alert>
        </div>
      </FoldGroup>
    </div>
  );
}
