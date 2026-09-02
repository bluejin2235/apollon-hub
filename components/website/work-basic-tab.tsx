"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  addFolder,
  deleteFolder,
  setWorkCategories,
  updateFolder,
  updateWork,
  uploadFile
} from "@/lib/website/api";
import type { WebsiteCategory } from "@/lib/website/types";
import type { WorkBasicDraft, WorkDetail, WorkFolder } from "@/lib/website/work-detail";
import { mediaUrl } from "@/lib/website/work-detail";
import { WORK_TITLE_EN_MAX } from "@/lib/website/text-width";
import { extractLoopPosters, revokeFrameUrls } from "@/lib/website/video-thumbs";
import { sanitizeUploadFilename, uploadObjectPath, workFolderPrefix } from "@/lib/website/upload-path";
import { prepareImageForUpload } from "@/lib/website/prepare-upload-image";
import { describeUploadError } from "@/lib/website/upload-error";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { AutoSaveLabel, PartialSaveBtn, type PartialSaveState } from "@/components/website/partial-save-btn";
import { TagPicker } from "@/components/website/tag-picker";
import { showToast } from "@/components/website/toast";
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

type HelpBody = {
  title: string;
  use: string;
  rule: string;
  note: React.ReactNode;
  empty: string;
};

const HELP = {
  title: {
    title: "제목",
    use: "목록 카드 · 상세 맨 위 · 브라우저 탭 · 검색 결과 제목 · 링크 공유 제목",
    rule: "46자. 넘으면 목록 카드에서 여러 줄이 됩니다",
    note: "국문 화면에서도 이 영문 제목이 그대로 나옵니다. 따옴표와 하이픈도 글자 수에 들어갑니다",
    empty: "공개할 수 없습니다"
  },
  cat: {
    title: "사업분야",
    use: "워크 목록 위 필터 · 목록 카드 · 상세 헤더(첫 번째만) · 본문 첫 블록 아래 정보 상자의 Typologies",
    rule: "최소 하나. 여러 개 고를 수 있고 순서를 바꿀 수 있습니다. 첫 번째가 대표입니다",
    note: "국문 화면에서도 영문으로 나옵니다. 둘 이상이면 카드에는 가운뎃점으로, 정보 상자에는 줄바꿈으로 나옵니다",
    empty: "공개할 수 없습니다"
  },
  tag: {
    title: "태그",
    use: "워크 목록 위 필터. 상세 페이지에는 나오지 않습니다",
    rule: "3~6개. 너무 많으면 필터가 지저분해집니다",
    note: "없는 태그를 치면 새로 만들 수 있습니다. 이미 있는 것을 쓰는 편이 낫습니다",
    empty: "필터에서 이 워크를 찾을 수 없습니다"
  },
  cli: {
    title: "클라이언트 · 위치",
    use: "본문 첫 블록 아래 정보 상자. Typologies · Location · Client 세 칸 중 둘입니다",
    rule: "영문으로만 씁니다. 위치는 시와 국가까지. 상세주소는 넣지 마세요",
    note: (
      <>
        시와 국가는 화면에서 <code>Incheon, Korea</code> 처럼 이어 붙습니다
      </>
    ),
    empty: "그 칸은 라벨만 남고 값이 빈칸으로 나옵니다"
  },
  key: {
    title: "대표 이미지",
    use: "목록 카드 · 메인 페이지 · 관련 콘텐츠 카드. 아래 「썸네일에 쓸 이미지」의 후보가 됩니다",
    rule: "긴 변이 1600 이상이어야 합니다. 보관은 긴 변 2560 으로 맞춥니다",
    note: "형식과 용량은 신경 쓰지 않아도 됩니다. 자동으로 바뀝니다. GIF 만 예외로 올린 그대로 나갑니다. 배경 영상 첫 장면과 맞추면 카드가 자연스럽습니다",
    empty: "공개할 수 없습니다"
  },
  tl: {
    title: "배경 영상 T-L",
    use: "목록 큰 카드 · 메인 wide 카드에 마우스를 올리면 도는 영상",
    rule: "1280 × 720 · 1.5MB 이하 · 4~6초 반복 · 16:9 반드시",
    note: "소리를 꼭 빼세요. 그래야 용량이 줍니다. 영상만 자동 변환이 안 되니 규격을 직접 맞춰야 합니다. 프리미어 H.264 · VBR 2패스 · 목표 2Mbps · 최대 4Mbps",
    empty: "카드에 마우스를 올려도 아무 일도 일어나지 않습니다"
  },
  ts: {
    title: "배경 영상 T-S",
    use: "목록 작은 카드 · 메인 grid 카드 · 관련 콘텐츠 카드",
    rule: "640 × 360 · 0.5MB 이하 · 4~6초 반복 · 16:9 반드시",
    note: "T-L 과 같은 영상을 해상도만 바꿔 내보내면 됩니다. 프리미어 목표 0.8Mbps · 최대 1.5Mbps",
    empty: "작은 카드가 T-L 을 내려받습니다. 파일이 세 배 커서 목록이 느려집니다"
  },
  card: {
    title: "썸네일에 쓸 이미지",
    use: "목록 카드에서 마우스를 올리기 전에 보이는 정지 이미지. 링크 공유 썸네일(og:image)과 검색엔진이 읽는 이미지로도 쓰입니다",
    rule: "하나만 고릅니다. 큰 카드·작은 카드에 각각 맞는 크기로 자동 변환되어 나갑니다",
    note: "영상 첫 장면이 어두울 때가 많아 대표 이미지 · T-L 첫 장면 · 직접 올리기 중에서 고르게 했습니다. 영상을 안 올렸으면 T-L 후보는 보이지 않습니다",
    empty: "공개할 수 없습니다"
  },
  slug: {
    title: "주소",
    use: "이 워크의 웹 주소. 검색엔진이 이 글자를 읽습니다",
    rule: "영문 소문자와 하이픈만. 제목의 뜻이 담기게 씁니다",
    note: "공개한 뒤에 바꾸면 그동안 쌓인 검색 순위가 사라지고, 외부에 걸린 링크가 끊깁니다",
    empty: "공개할 수 없습니다"
  },
  sum: {
    title: "한 줄 요약",
    use: "구글 검색 결과에서 제목 아래 나오는 설명문. 링크를 공유할 때도 이 글이 보입니다. 화면에는 나오지 않습니다",
    rule: "국문 80자 · 영문 155자. 넘으면 검색 결과에서 잘립니다",
    note: "무엇을 어떻게 바꿨는지 한 문장으로. 검색하는 사람이 이 글을 보고 누를지 정합니다",
    empty: "공개할 수 없습니다. 검색 결과에 설명이 없으면 클릭률이 떨어집니다"
  },
  alt: {
    title: "대체 텍스트",
    use: "이미지가 안 뜰 때 그 자리에 나오는 글. 화면 읽기 프로그램이 읽어주고, 검색엔진과 AI 도 이 글로 이미지를 이해합니다",
    rule: "보이는 것을 그대로 씁니다. 40자 안쪽",
    note: "「이미지」 「사진」 같은 말은 넣지 마세요. 무엇이 찍혀 있는지만 적습니다",
    empty: "공개할 수 없습니다"
  },
  fld: {
    title: "내부 연결",
    use: "Work 서버의 실제 폴더 경로. 사이트에 나가지 않고, 루나가 이 워크의 원본 파일을 찾을 때 씁니다",
    rule: "T: · P: 로 시작하는 전체 경로",
    note: "폴더를 옮기면 여기도 고쳐야 합니다. 경로가 틀리면 루나가 파일을 못 찾습니다",
    empty: "공개에는 영향이 없습니다. 다만 나중에 원본을 찾기 어려워집니다"
  }
} satisfies Record<string, HelpBody>;

function filled(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function apiFailMessage(res: { error: string; details?: unknown }): string {
  const details = res.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return `${res.error}: ${message}`;
    }
  }
  return res.error + (details != null ? ` · ${JSON.stringify(details)}` : "");
}

function isPlaceholderKey(src: string) {
  return !src.trim() || /placeholder-wide/i.test(src);
}

function useFoldPartialSave(workId: string, onReload: () => Promise<void>) {
  const [state, setState] = useState<PartialSaveState>("idle");

  const markDirty = useCallback(() => {
    setState((cur) => (cur === "saving" ? cur : "dirty"));
  }, []);

  const save = useCallback(
    async (build: () => Promise<boolean> | boolean) => {
      setState("saving");
      const ok = await build();
      if (!ok) {
        setState("dirty");
        return false;
      }
      setState("saved");
      window.setTimeout(() => setState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      await onReload();
      return true;
    },
    [onReload]
  );

  return { state, markDirty, save };
}

function HelpPanel({
  open,
  body,
  onClose
}: {
  open: boolean;
  body: HelpBody;
  onClose: () => void;
}) {
  return (
    <div className={open ? "qp on" : "qp"}>
      <div className="qph">
        <b>{body.title}</b>
        <button type="button" className="xb" onClick={onClose}>
          ×
        </button>
      </div>
      <dl>
        <dt>쓰임</dt>
        <dd>{body.use}</dd>
        <dt>기준</dt>
        <dd>{body.rule}</dd>
        <dt>주의</dt>
        <dd>{body.note}</dd>
        <dt>비면</dt>
        <dd>{body.empty}</dd>
      </dl>
    </div>
  );
}

function splitFolders(folders: WorkFolder[]) {
  const sorted = [...folders].sort((a, b) => a.sort - b.sort);
  const isProject = (item: WorkFolder) =>
    item.kind === "ko" || item.name.trim() === "프로젝트 폴더";
  const isBiz = (item: WorkFolder) => item.kind === "en";
  const project =
    sorted.find(isProject) ??
    sorted.find((item) => filled(item.path) && !isBiz(item)) ??
    null;
  const video = sorted.find((item) => isBiz(item) && item.id !== project?.id) ?? null;
  const extras = sorted.filter((item) => item.id !== project?.id && item.id !== video?.id);
  return { project, video, extras };
}

async function uploadLoopFirstFrame(file: File, folder: string): Promise<string[]> {
  const frames = await extractLoopPosters(file);
  if (frames.length === 0) return [];
  const frame = frames[0]!;
  try {
    const name = sanitizeUploadFilename("loop-poster-first.jpg");
    const path = uploadObjectPath(folder, name);
    const blobFile = new File([frame.blob], name, { type: "image/jpeg" });
    const res = await uploadFile(blobFile, "works", path, { fields: { role: "key" } });
    if (res.ok && res.data?.publicUrl) {
      return [res.data.publicUrl];
    }
    return [];
  } finally {
    revokeFrameUrls(frames);
  }
}

function FolderKindRow({
  label,
  placeholder,
  folder,
  kind,
  sort,
  workId,
  onReload
}: {
  label: string;
  placeholder: string;
  folder: WorkFolder | null;
  kind: "ko" | "en";
  sort: number;
  workId: string;
  onReload: () => Promise<void>;
}) {
  const [local, setLocal] = useState(folder?.path ?? "");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="fld-path">
        <span className="fx">{label}</span>
        <input
          className="i"
          value={local}
          placeholder={placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
        />
        <span />
      </div>
      {error ? <p className="hint-line warn">{error}</p> : null}
    </>
  );
}

function ExtraFolderRow({
  name,
  path,
  onNameBlur,
  onPathBlur,
  onDelete,
  error
}: {
  name: string;
  path: string;
  onNameBlur: (name: string) => void;
  onPathBlur: (path: string) => void;
  onDelete: () => void;
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
      <div className="fld-path">
        <input
          className="i"
          value={localName}
          placeholder="폴더 이름"
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
        <button type="button" className="xb-row" onClick={onDelete}>
          ×
        </button>
      </div>
      {error ? <p className="hint-line warn">{error}</p> : null}
    </>
  );
}

export function WorkBasicTab({ draft, onChange, work, categories, siteUrl, onReload }: Props) {
  const folders = [...(work.work_folders ?? [])].sort((a, b) => a.sort - b.sort);
  const tags = [...(work.work_tags ?? [])].sort((a, b) => a.sort - b.sort);
  const uploadRoot = workFolderPrefix(draft.slug || work.slug, work.id);
  const { project, video, extras } = splitFolders(folders);
  const [editingCategory, setEditingCategory] = useState(false);
  const [pendingExtras, setPendingExtras] = useState<PendingExtra[]>([]);
  const [extraErrors, setExtraErrors] = useState<Record<string, string>>({});
  const [openHelp, setOpenHelp] = useState<keyof typeof HELP | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState(draft.summary);
  const pendingKey = useId();
  const loopLgFile = useRef<File | null>(null);
  const cardUploadRef = useRef<HTMLInputElement>(null);

  const screenPartial = useFoldPartialSave(work.id, onReload);
  const mediaPartial = useFoldPartialSave(work.id, onReload);
  const searchPartial = useFoldPartialSave(work.id, onReload);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const selectedCategories = draft.category_ids.map((id) => ({
    id,
    label: categories.find((item) => item.id === id)?.label?.ko || id
  }));
  const addableCategories = categories.filter((item) => !draft.category_ids.includes(item.id));
  const categoryLabel = selectedCategories.map((item) => item.label).join(" · ") || "—";

  const titleEn = draft.title.en;
  const titleCount = titleEn.length;
  const keyFilled = !isPlaceholderKey(draft.key_image);
  const cardFilled = filled(draft.card_image);
  const screenDone = [
    filled(titleEn) && titleCount <= WORK_TITLE_EN_MAX,
    draft.category_ids.length > 0,
    filled(draft.year),
    tags.length > 0,
    filled(draft.client.en) || filled(draft.location_city.en) || filled(draft.location_country.en)
  ].filter(Boolean).length;
  const mediaDone = [
    keyFilled,
    filled(draft.loop_video_lg),
    filled(draft.loop_video_sm)
  ].filter(Boolean).length;
  const searchDone = [
    filled(draft.slug),
    filled(draft.summary.ko) && draft.summary.ko.length <= 80 && draft.summary.en.length <= 155,
    filled(draft.key_image_alt.ko)
  ].filter(Boolean).length;

  function toggleHelp(id: keyof typeof HELP) {
    setOpenHelp((cur) => (cur === id ? null : id));
  }

  function setTitleEn(value: string) {
    screenPartial.markDirty();
    onChange({ title: { ko: value, en: value } });
  }

  function addCategory(id: string) {
    if (!id || draft.category_ids.includes(id)) return;
    screenPartial.markDirty();
    onChange({ category_ids: [...draft.category_ids, id] });
  }

  function removeCategory(id: string) {
    if (draft.category_ids.length <= 1) return;
    screenPartial.markDirty();
    onChange({ category_ids: draft.category_ids.filter((item) => item !== id) });
  }

  function moveCategory(index: number, dir: -1 | 1) {
    const next = [...draft.category_ids];
    const to = index + dir;
    if (to < 0 || to >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    screenPartial.markDirty();
    onChange({ category_ids: next });
  }

  function pickCard(src: string, source: string, width: number | null, height: number | null) {
    const patch = {
      card_image: src,
      card_image_source: source,
      card_image_width: width,
      card_image_height: height
    };
    draftRef.current = { ...draftRef.current, ...patch };
    mediaPartial.markDirty();
    onChange(patch);
  }

  async function handleLoopUpload(
    kind: "lg" | "sm",
    files: UploadedMedia[],
    local: File | null
  ) {
    const first = files[0];
    if (!first) return;
    mediaPartial.markDirty();

    if (kind === "sm") {
      onChange({ loop_video_sm: first.src, loop_sm_posters: [] });
      return;
    }

    onChange({ loop_video_lg: first.src });
    let posters: string[] = [];
    if (local) {
      try {
        posters = await uploadLoopFirstFrame(local, `${uploadRoot}/loop-posters`);
      } catch {
        posters = [];
      }
    }
    onChange({
      loop_video_lg: first.src,
      loop_lg_posters: posters,
      loop_sm_posters: []
    });
  }

  async function saveScreen() {
    return screenPartial.save(async () => {
      const d = draftRef.current;
      const cat = await setWorkCategories(work.id, d.category_ids);
      if (!cat.ok) {
        showToast({ tone: "error", message: apiFailMessage(cat) });
        return false;
      }
      const res = await updateWork(work.id, {
        title: { ko: d.title.en, en: d.title.en },
        year: d.year || null,
        client: { ko: d.client.ko, en: d.client.en },
        location_city: { ko: d.location_city.ko, en: d.location_city.en },
        location_country: {
          ko: d.location_country.ko,
          en: d.location_country.en
        }
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

  async function saveMedia() {
    return mediaPartial.save(async () => {
      const d = draftRef.current;
      const res = await updateWork(work.id, {
        key_image: d.key_image || null,
        key_image_width: d.key_image ? d.key_image_width : null,
        key_image_height: d.key_image ? d.key_image_height : null,
        card_image: d.card_image || null,
        card_image_source: d.card_image ? d.card_image_source || null : null,
        card_image_width: d.card_image ? d.card_image_width : null,
        card_image_height: d.card_image ? d.card_image_height : null,
        loop_video_lg: d.loop_video_lg || null,
        loop_video_sm: d.loop_video_sm || null,
        loop_lg_posters: d.loop_lg_posters ?? [],
        loop_sm_posters: []
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

  async function saveSearch() {
    return searchPartial.save(async () => {
      const d = draftRef.current;
      const res = await updateWork(work.id, {
        slug: d.slug,
        summary: d.summary,
        key_image_alt: d.key_image_alt
      });
      if (!res.ok) {
        showToast({ tone: "error", message: apiFailMessage(res) });
        return false;
      }
      return true;
    });
  }

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

  const keyUrl = mediaUrl(siteUrl, keyFilled ? draft.key_image : null);
  const cardSource = draft.card_image_source;
  const lgFirst = (draft.loop_lg_posters ?? [])[0] ?? "";
  const lgFirstUrl = mediaUrl(siteUrl, lgFirst || null);

  return (
    <div className="wa">
      <section className="grp">
        <div className="grph">
          <h3>화면에 나오는 것</h3>
          <div className="grpr">
            <span className={screenDone >= 5 ? "cnt" : "cnt warn"}>
              {screenDone} / 5
            </span>
            <PartialSaveBtn state={screenPartial.state} onClick={() => void saveScreen()} />
          </div>
        </div>
        <p className="grpd">방문자가 사이트에서 실제로 보는 값입니다.</p>

        <div className="box">
          <div className="f">
            <div className="fl">
              <span className="nm">제목</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("title")}>
                ?
              </button>
              <span className={titleCount > WORK_TITLE_EN_MAX ? "cc over" : "cc"}>
                <b>{titleCount}</b> / {WORK_TITLE_EN_MAX}
              </span>
            </div>
            <input className="i" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            <p className="hint-line">영문으로만 입력합니다. 목록 카드와 상세 맨 위에 나옵니다</p>
            <HelpPanel
              open={openHelp === "title"}
              body={HELP.title}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="row-cy">
              <div>
                <div className="fl">
                  <span className="nm">사업분야</span>
                  <span className="rq">*</span>
                  <button type="button" className="q" onClick={() => toggleHelp("cat")}>
                    ?
                  </button>
                </div>
                {editingCategory ? (
                  <div>
                    <div className="fld repeat-box">
                      {selectedCategories.map((item, index) => (
                        <div className="repeat-row" key={item.id}>
                          <span className="whitespace-nowrap">{item.label}</span>
                          <span className="repeat-save">{index === 0 ? "대표" : ""}</span>
                          <div className="repeat-acts">
                            <button
                              type="button"
                              className="ico"
                              disabled={index === 0}
                              onClick={() => moveCategory(index, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="ico"
                              disabled={index === selectedCategories.length - 1}
                              onClick={() => moveCategory(index, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="ico"
                              disabled={selectedCategories.length <= 1}
                              onClick={() => removeCategory(item.id)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="ro">
                      <select
                        className="i"
                        value=""
                        disabled={addableCategories.length === 0}
                        onChange={(e) => addCategory(e.target.value)}
                      >
                        <option value="">
                          {addableCategories.length === 0
                            ? "더 고를 분야가 없습니다"
                            : "＋ 분야 더 고르기"}
                        </option>
                        {addableCategories.map((item) => (
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
                  </div>
                ) : (
                  <div className="cat-box">
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
                <p className="hint-line">첫 번째가 대표입니다. 카드와 상세에 영문으로 나옵니다</p>
              </div>
              <div>
                <div className="fl">
                  <span className="nm">완공 연도</span>
                  <span className="rq">*</span>
                </div>
                <input
                  className="i"
                  value={draft.year}
                  onChange={(e) => {
                    screenPartial.markDirty();
                    onChange({ year: e.target.value });
                  }}
                />
                <p className="hint-line">상세 제목 아래</p>
              </div>
            </div>
            <HelpPanel
              open={openHelp === "cat"}
              body={HELP.cat}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">태그</span>
              <button type="button" className="q" onClick={() => toggleHelp("tag")}>
                ?
              </button>
            </div>
            <TagPicker
              workId={work.id}
              selectedIds={tags.map((t) => t.tag_id)}
              onReload={onReload}
            />
            <p className="hint-line">워크 목록 위 필터에 쓰입니다. 3~6개를 권합니다</p>
            <HelpPanel
              open={openHelp === "tag"}
              body={HELP.tag}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">클라이언트 · 위치</span>
              <button type="button" className="q" onClick={() => toggleHelp("cli")}>
                ?
              </button>
            </div>
            <div className="row-cli">
              <div>
                <input
                  className="i"
                  value={draft.client.en}
                  onChange={(e) => {
                    screenPartial.markDirty();
                    onChange({ client: { ...draft.client, en: e.target.value } });
                  }}
                />
                <p className="hint-line">클라이언트</p>
              </div>
              <div>
                <input
                  className="i"
                  value={draft.location_city.en}
                  onChange={(e) => {
                    screenPartial.markDirty();
                    onChange({
                      location_city: { ...draft.location_city, en: e.target.value }
                    });
                  }}
                />
                <p className="hint-line">시</p>
              </div>
              <div>
                <input
                  className="i"
                  value={draft.location_country.en}
                  onChange={(e) => {
                    screenPartial.markDirty();
                    onChange({
                      location_country: { ...draft.location_country, en: e.target.value }
                    });
                  }}
                />
                <p className="hint-line">국가</p>
              </div>
            </div>
            <p className="hint-line">본문 첫 블록 아래 정보 상자에 나옵니다</p>
            <HelpPanel
              open={openHelp === "cli"}
              body={HELP.cli}
              onClose={() => setOpenHelp(null)}
            />
          </div>
        </div>
      </section>

      <section className="grp">
        <div className="grph">
          <h3>이미지와 영상</h3>
          <div className="grpr">
            <span className={mediaDone >= 3 ? "cnt" : "cnt warn"}>{mediaDone} / 3</span>
            <PartialSaveBtn state={mediaPartial.state} onClick={() => void saveMedia()} />
          </div>
        </div>
        <p className="grpd">
          배경 영상은 목록 카드에 마우스를 올리면 돕니다. 큰 카드는 T-L, 작은 카드는 T-S 를
          씁니다.
        </p>

        <div className="box">
          <div className="up3">
            <div className="upc">
              <div className="fl">
                <span className="nm">대표 이미지</span>
                <span className="rq">*</span>
                <button type="button" className="q" onClick={() => toggleHelp("key")}>
                  ?
                </button>
              </div>
              <ImageUploader
                bucket="works"
                folder={`${uploadRoot}/key`}
                accept="image"
                multiple={false}
                kind="key"
                appearance="filecard"
                siteUrl={siteUrl}
                value={keyFilled ? draft.key_image : null}
                emptyHint="올리기"
                onUploaded={(files) => {
                  const first = files[0];
                  if (!first) return;
                  mediaPartial.markDirty();
                  const patch: Partial<WorkBasicDraft> = {
                    key_image: first.src,
                    key_image_width: first.width,
                    key_image_height: first.height
                  };
                  if (!cardFilled || cardSource === "key") {
                    patch.card_image = first.src;
                    patch.card_image_source = "key";
                    patch.card_image_width = first.width;
                    patch.card_image_height = first.height;
                  }
                  onChange(patch);
                }}
                onClear={() => {
                  mediaPartial.markDirty();
                  const patch: Partial<WorkBasicDraft> = {
                    key_image: "",
                    key_image_width: null,
                    key_image_height: null
                  };
                  if (cardSource === "key") {
                    patch.card_image = "";
                    patch.card_image_source = "";
                    patch.card_image_width = null;
                    patch.card_image_height = null;
                  }
                  onChange(patch);
                }}
              />
              <p className="spec">
                긴 변 1600 이상
                <br />
                {draft.key_image_width && draft.key_image_height ? (
                  <span className="now">
                    지금 {draft.key_image_width} × {draft.key_image_height}
                  </span>
                ) : null}
              </p>
            </div>

            <div className="upc">
              <div className="fl">
                <span className="nm">배경 영상 T-L</span>
                <button type="button" className="q" onClick={() => toggleHelp("tl")}>
                  ?
                </button>
              </div>
              <ImageUploader
                bucket="works"
                folder={`${uploadRoot}/loop`}
                accept="video"
                workId={work.id}
                multiple={false}
                kind="loop-lg"
                appearance="filecard"
                siteUrl={siteUrl}
                value={draft.loop_video_lg || null}
                emptyHint="올리기"
                onLocalFiles={(files) => {
                  loopLgFile.current = files[0] ?? null;
                }}
                onUploaded={(files) => {
                  const local = loopLgFile.current;
                  loopLgFile.current = null;
                  void handleLoopUpload("lg", files, local);
                }}
                onClear={() => {
                  mediaPartial.markDirty();
                  onChange({ loop_video_lg: "", loop_lg_posters: [] });
                }}
              />
              <p className="spec">
                16:9 · 1280 × 720 · 1.5MB 이하 · 4~6초 · 소리 없음
                <br />
                {filled(draft.loop_video_lg) ? (
                  <span className="now">지금 업로드됨</span>
                ) : null}
              </p>
            </div>

            <div className="upc">
              <div className="fl">
                <span className="nm">배경 영상 T-S</span>
                <button type="button" className="q" onClick={() => toggleHelp("ts")}>
                  ?
                </button>
              </div>
              <ImageUploader
                bucket="works"
                folder={`${uploadRoot}/loop`}
                accept="video"
                workId={work.id}
                multiple={false}
                kind="loop-sm"
                appearance="filecard"
                siteUrl={siteUrl}
                value={draft.loop_video_sm || null}
                emptyHint="올리기"
                onUploaded={(files) => {
                  void handleLoopUpload("sm", files, null);
                }}
                onClear={() => {
                  mediaPartial.markDirty();
                  onChange({ loop_video_sm: "", loop_sm_posters: [] });
                }}
              />
              <p className="spec">
                16:9 · 640 × 360 · 0.5MB 이하 · 4~6초 · 소리 없음
                <br />
                {filled(draft.loop_video_sm) ? (
                  <span className="now">지금 업로드됨</span>
                ) : (
                  <span className="bad">아직 없음 · T-L 을 대신 씁니다</span>
                )}
              </p>
            </div>
          </div>

          <HelpPanel open={openHelp === "key"} body={HELP.key} onClose={() => setOpenHelp(null)} />
          <HelpPanel open={openHelp === "tl"} body={HELP.tl} onClose={() => setOpenHelp(null)} />
          <HelpPanel open={openHelp === "ts"} body={HELP.ts} onClose={() => setOpenHelp(null)} />

          <div className="card-sep">
            <div className="fl">
              <span className="nm">썸네일에 쓸 이미지</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("card")}>
                ?
              </button>
            </div>
            <p className="grpd">
              배경 영상 T-L 을 올리면 첫 장면이 자동으로 만들어집니다. 그중 하나를 고르세요.
            </p>

            <div className="pick">
              {keyFilled ? (
                <button
                  type="button"
                  className={cardSource === "key" ? "pk on" : "pk"}
                  onClick={() =>
                    pickCard(draft.key_image, "key", draft.key_image_width, draft.key_image_height)
                  }
                >
                  <div className="im">
                    {keyUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={keyUrl} alt="" />
                    ) : null}
                  </div>
                  <div className="cap">{cardSource === "key" ? "✓ 대표 이미지" : "대표 이미지"}</div>
                </button>
              ) : null}

              {lgFirst ? (
                <button
                  type="button"
                  className={
                    cardSource === "loop_lg" ||
                    (cardSource.startsWith("loop_lg") && draft.card_image === lgFirst)
                      ? "pk on"
                      : "pk"
                  }
                  onClick={() => pickCard(lgFirst, "loop_lg", null, null)}
                >
                  <div className="im">
                    {lgFirstUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lgFirstUrl} alt="" />
                    ) : null}
                  </div>
                  <div className="cap">
                    {cardSource === "loop_lg" ||
                    (cardSource.startsWith("loop_lg") && draft.card_image === lgFirst)
                      ? "✓ T-L 첫 장면"
                      : "T-L 첫 장면"}
                  </div>
                </button>
              ) : null}

              <button
                type="button"
                className={cardSource === "upload" ? "pk add on" : "pk add"}
                onClick={() => cardUploadRef.current?.click()}
              >
                <span className="up-ic">⬆</span>
                <span>직접 올리기</span>
              </button>
              <input
                ref={cardUploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void (async () => {
                    const prepared = await prepareImageForUpload(file, "key");
                    if (!prepared.ok) {
                      showToast({ message: prepared.error, tone: "error" });
                      return;
                    }
                    const name = sanitizeUploadFilename(prepared.data.file.name, [], prepared.data.file.type);
                    const path = uploadObjectPath(`${uploadRoot}/card`, name);
                    const res = await uploadFile(prepared.data.file, "works", path, {
                      fields: { role: "key" }
                    });
                    if (!res.ok || !res.data?.publicUrl) {
                      const parsed = describeUploadError(res.ok ? "request_failed" : res.error, res.ok ? 0 : res.status, res.ok ? undefined : res.details);
                      showToast({ message: parsed.message, tone: "error" });
                      return;
                    }
                    pickCard(
                      res.data.publicUrl,
                      "upload",
                      res.data.width ?? prepared.data.to.width,
                      res.data.height ?? prepared.data.to.height
                    );
                  })();
                }}
              />
            </div>

            <p className="hint-line">
              고른 이미지가 목록 카드와 링크 공유 썸네일에 쓰입니다. 크기는 화면에 맞게 자동으로
              줄여 나갑니다
            </p>
            <HelpPanel
              open={openHelp === "card"}
              body={HELP.card}
              onClose={() => setOpenHelp(null)}
            />
          </div>
        </div>
      </section>

      <section className="grp">
        <div className="grph">
          <h3>검색과 AI 가 읽는 것</h3>
          <div className="grpr">
            <span className={searchDone >= 3 ? "cnt" : "cnt warn"}>{searchDone} / 3</span>
            <PartialSaveBtn state={searchPartial.state} onClick={() => void saveSearch()} />
          </div>
        </div>
        <p className="grpd">화면에는 안 보이지만 구글과 AI 가 읽어갑니다. 비면 검색에서 잡히지 않습니다.</p>

        <div className="box">
          <div className="f">
            <div className="fl">
              <span className="nm">주소</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("slug")}>
                ?
              </button>
            </div>
            <div className="slugrow">
              <span className="pre">apollonworks.com/works/</span>
              <input
                className="i"
                value={draft.slug}
                onChange={(e) => {
                  searchPartial.markDirty();
                  onChange({ slug: e.target.value });
                }}
              />
            </div>
            <p className="hint-line warn">공개한 뒤에는 바꾸지 마세요. 검색 순위가 초기화됩니다</p>
            <HelpPanel
              open={openHelp === "slug"}
              body={HELP.slug}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">한 줄 요약</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("sum")}>
                ?
              </button>
              <button
                type="button"
                className="btn xs ml-auto"
                onClick={() => {
                  setSummaryDraft(draft.summary);
                  setSummaryOpen(true);
                }}
              >
                ⤢ 크게 열기
              </button>
            </div>
            <div className="two">
              <textarea
                className="i"
                rows={2}
                value={draft.summary.ko}
                onChange={(e) => {
                  searchPartial.markDirty();
                  onChange({ summary: { ...draft.summary, ko: e.target.value } });
                }}
              />
              <textarea
                className="i"
                rows={2}
                value={draft.summary.en}
                onChange={(e) => {
                  searchPartial.markDirty();
                  onChange({ summary: { ...draft.summary, en: e.target.value } });
                }}
              />
            </div>
            <div className="sum-foot">
              <p className="hint-line">검색 결과에 제목 아래 나오는 설명문입니다</p>
              <span className="cc">
                국문 <b>{draft.summary.ko.length}</b>/80 · 영문 <b>{draft.summary.en.length}</b>
                /155
              </span>
            </div>
            <HelpPanel
              open={openHelp === "sum"}
              body={HELP.sum}
              onClose={() => setOpenHelp(null)}
            />
          </div>

          <div className="f">
            <div className="fl">
              <span className="nm">카드 이미지 대체 텍스트</span>
              <span className="rq">*</span>
              <button type="button" className="q" onClick={() => toggleHelp("alt")}>
                ?
              </button>
              <span className={draft.key_image_alt.ko.length > 40 ? "cc over" : "cc"}>
                국문 <b>{draft.key_image_alt.ko.length}</b> / 40
              </span>
            </div>
            <div className="two">
              <input
                className="i"
                value={draft.key_image_alt.ko}
                onChange={(e) => {
                  searchPartial.markDirty();
                  onChange({
                    key_image_alt: { ...draft.key_image_alt, ko: e.target.value }
                  });
                }}
              />
              <input
                className="i"
                value={draft.key_image_alt.en}
                onChange={(e) => {
                  searchPartial.markDirty();
                  onChange({
                    key_image_alt: { ...draft.key_image_alt, en: e.target.value }
                  });
                }}
              />
            </div>
            <p className="hint-line">이미지를 못 보는 사람과 AI 가 읽습니다</p>
            <HelpPanel
              open={openHelp === "alt"}
              body={HELP.alt}
              onClose={() => setOpenHelp(null)}
            />
          </div>
        </div>
      </section>

      <section className="grp">
        <div className="grph">
          <h3>그 밖의 것</h3>
          <AutoSaveLabel />
        </div>
        <p className="grpd">사이트에 나오지 않습니다. 루나가 파일을 찾을 때 씁니다.</p>

        <div className="box">
          <div className="fl">
            <span className="nm">내부 연결</span>
            <button type="button" className="q" onClick={() => toggleHelp("fld")}>
              ?
            </button>
          </div>

          <FolderKindRow
            label="프로젝트 폴더"
            placeholder="T:\..."
            folder={project}
            kind="ko"
            sort={0}
            workId={work.id}
            onReload={onReload}
          />
          <FolderKindRow
            label="사업개발 폴더"
            placeholder="P:\..."
            folder={video}
            kind="en"
            sort={project ? 1 : 0}
            workId={work.id}
            onReload={onReload}
          />
          {extras.map((item) => (
            <ExtraFolderRow
              key={item.id}
              name={item.name}
              path={item.path}
              error={extraErrors[item.id]}
              onNameBlur={(value) => void commitExtraName(item.id, value)}
              onPathBlur={(nextPath) => void commitExtraPath(item.id, nextPath)}
              onDelete={() => void deleteExtra(item.id)}
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
              onDelete={() =>
                setPendingExtras((prev) => prev.filter((row) => row.key !== item.key))
              }
            />
          ))}
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              setPendingExtras((prev) => [
                ...prev,
                { key: `${pendingKey}-${prev.length}-${Date.now()}`, name: "", path: "" }
              ])
            }
          >
            ＋ 폴더 추가
          </button>
          <p className="hint-line">앞의 두 줄은 이름이 정해져 있고, 아래는 이름을 직접 적습니다</p>
          <HelpPanel
            open={openHelp === "fld"}
            body={HELP.fld}
            onClose={() => setOpenHelp(null)}
          />
        </div>
      </section>

      <div className={summaryOpen ? "big-ov on" : "big-ov"}>
        <div className="big-mw">
          <div className="big-mwh">
            <b>한 줄 요약</b>
            <button type="button" className="xb" onClick={() => setSummaryOpen(false)}>
              ×
            </button>
          </div>
          <div className="big-tb">
            <span>B</span>
            <span>I</span>
            <span>≡</span>
            <span>🔗</span>
          </div>
          <div className="two">
            <div>
              <p className="hint-line">국문 · {summaryDraft.ko.length} / 80</p>
              <textarea
                className="i"
                rows={7}
                value={summaryDraft.ko}
                onChange={(e) => setSummaryDraft({ ...summaryDraft, ko: e.target.value })}
              />
            </div>
            <div>
              <p className="hint-line">영문 · {summaryDraft.en.length} / 155</p>
              <textarea
                className="i"
                rows={7}
                value={summaryDraft.en}
                onChange={(e) => setSummaryDraft({ ...summaryDraft, en: e.target.value })}
              />
            </div>
          </div>
          <p className="big-note">편집 도구는 자리만 잡아 두었습니다. 이번 단계에서는 동작하지 않습니다.</p>
          <div className="big-mwf">
            <button type="button" className="btn sm" onClick={() => setSummaryOpen(false)}>
              취소
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                searchPartial.markDirty();
                onChange({ summary: summaryDraft });
                setSummaryOpen(false);
              }}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
