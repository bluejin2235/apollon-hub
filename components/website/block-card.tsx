"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  addImages,
  createBlock,
  deleteBlock,
  deleteImage,
  reorderImages,
  updateBlock,
  updateImage
} from "@/lib/website/api";
import type { BlockImage, ContentBlock, Loc } from "@/lib/website/work-detail";
import { asLoc, columnsFromBody, emptyLoc, fileName, mediaUrl } from "@/lib/website/work-detail";
import { TextDupHint } from "@/components/website/text-dup-hint";
import { useDebouncedValue, useTextDup } from "@/components/website/text-dup-context";
import {
  ALL_PRESETS,
  defaultTextSide,
  EMBED_PROVIDERS,
  hasBody,
  hasImages,
  imageLimitForPreset,
  PRESET_LABEL,
  textColumnCount
} from "@/components/website/block-presets";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { PosterPicker } from "@/components/website/poster-picker";
import { uploadFile } from "@/lib/website/api";
import {
  sanitizeUploadFilename,
  uploadObjectPath
} from "@/lib/website/upload-path";
import {
  extractFrames,
  extractFramesAlt,
  revokeFrameUrls,
  type ExtractedFrame,
  type VideoFrameMeta
} from "@/lib/website/video-thumbs";
import {
  AiBadge,
  AiBtn,
  BilingualField,
  CharKo,
  CharPair,
  FieldLabel,
  GhostBtn,
  Guide,
  LangEn,
  LangKo,
  locField,
  Sep,
  SmallBtn,
  TextArea,
  TextInput,
  ToggleRow
} from "@/components/website/work-editor-ui";
import { GuideTerm } from "@/components/website/ui/GuideTerm";
import {
  formatBodyImageHint,
  formatBodyImageRejectHint,
  formatDetailMovieHint,
  formatPortraitBodyImageHint,
  VIDEO_LABELS
} from "@/lib/website/spec";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  block: ContentBlock;
  index: number;
  total: number;
  sectionId: string;
  workId: string;
  uploadRoot: string;
  siteUrl: string;
  onReload: () => Promise<void>;
  onMove: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  isFirstSection?: boolean;
  metaTakenByOther?: boolean;
};

function formatBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export function BlockCard({
  block,
  index,
  total,
  sectionId,
  workId,
  uploadRoot,
  siteUrl,
  onReload,
  onMove,
  canMoveUp = index > 1,
  canMoveDown = index < total,
  collapsed,
  onToggle,
  isFirstSection = false,
  metaTakenByOther = false
}: Props) {
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [changePreset, setChangePreset] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const columnCount = textColumnCount(block.preset);
  const [body, setBody] = useState<Loc>(() =>
    columnCount > 0 ? emptyLoc() : asLoc(block.body)
  );
  const [columns, setColumns] = useState<Loc[]>(() =>
    columnsFromBody(block.body, columnCount || 2)
  );
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const [videoKind, setVideoKind] = useState(
    block.video_kind === "loop" ? "hosted" : (block.video_kind ?? "embed")
  );
  const [videoUrl, setVideoUrl] = useState(block.video_url ?? "");
  const [videoPoster, setVideoPoster] = useState(block.video_poster ?? "");
  const [videoAlt, setVideoAlt] = useState<Loc>(asLoc(block.video_alt));
  const [embedProvider, setEmbedProvider] = useState(block.embed_provider ?? "youtube");
  const [embedUrl, setEmbedUrl] = useState(block.embed_url ?? "");
  const [embedTitle, setEmbedTitle] = useState<Loc>(asLoc(block.embed_title));
  const [embedPoster, setEmbedPoster] = useState(block.embed_poster ?? "");
  const [rowHeight, setRowHeight] = useState(block.gallery_row_height ?? 320);
  const [textSide, setTextSide] = useState<"left" | "right">(block.text_side ?? defaultTextSide(block.preset));
  const [showMeta, setShowMeta] = useState(block.show_meta);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const nextCount = textColumnCount(block.preset);
    if (nextCount > 0) {
      setColumns(columnsFromBody(block.body, nextCount));
    } else {
      setBody(asLoc(block.body));
    }
    setVideoKind(block.video_kind === "loop" ? "hosted" : (block.video_kind ?? "embed"));
    setVideoUrl(block.video_url ?? "");
    setVideoPoster(block.video_poster ?? "");
    setVideoAlt(asLoc(block.video_alt));
    setEmbedProvider(block.embed_provider ?? "youtube");
    setEmbedUrl(block.embed_url ?? "");
    setEmbedTitle(asLoc(block.embed_title));
    setEmbedPoster(block.embed_poster ?? "");
    setRowHeight(block.gallery_row_height ?? 320);
    setTextSide(block.text_side ?? defaultTextSide(block.preset));
    setShowMeta(block.show_meta);
  }, [block]);

  const images = [...(block.block_images ?? [])].sort((a, b) => a.sort - b.sort);
  const limit = imageLimitForPreset(block.preset);
  const atLimit = limit !== null && images.length >= limit;
  const presetName = PRESET_LABEL[block.preset] ?? block.preset;
  const chip =
    block.preset.startsWith("video")
      ? block.video_kind === "file" || (!block.video_url && Boolean(block.video_poster))
        ? "업로드"
        : block.video_url?.includes("vimeo")
          ? "Vimeo"
          : block.video_url
            ? "유튜브"
            : "영상"
      : block.preset === "embed"
        ? (EMBED_PROVIDERS.find((item) => item.id === block.embed_provider)?.label ?? "임베드")
        : null;

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 1500);
  }

  async function persist(patch: Record<string, unknown>): Promise<boolean> {
    setSave("saving");
    setError(null);
    try {
      const res = await updateBlock(sectionId, block.id, patch);
      if (!res.ok) {
        setSave("error");
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return false;
      }
      setSave("saved");
      return true;
    } catch (err) {
      setSave("error");
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
      return false;
    } finally {
      setSave((cur) => (cur === "saving" ? "idle" : cur));
    }
  }

  async function flush(patch: Record<string, unknown>): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    return persist(patch);
  }

  async function onDelete() {
    const res = await deleteBlock(sectionId, block.id);
    setDeleteOpen(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  async function onClone() {
    const res = await createBlock(sectionId, {
      preset: block.preset,
      sort: block.sort + 1,
      body: block.body,
      video_kind: block.video_kind,
      video_url: block.video_url,
      video_poster: block.video_poster,
      video_alt: block.video_alt,
      embed_provider: block.embed_provider,
      embed_url: block.embed_url,
      embed_title: block.embed_title,
      embed_poster: block.embed_poster,
      gallery_row_height: block.gallery_row_height,
      text_side: block.text_side
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const newId = typeof res.data.id === "string" ? res.data.id : null;
    if (newId && images.length > 0) {
      await addImages(
        newId,
        images.map((img, i) => ({
          src: img.src,
          width: img.width,
          height: img.height,
          alt: img.alt,
          caption: img.caption,
          caption_visible: img.caption_visible,
          sort: i
        }))
      );
    }
    await onReload();
  }

  async function onChangePreset(next: string) {
    setChangePreset(false);
    const res = await updateBlock(sectionId, block.id, { preset: next });
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      return;
    }
    await onReload();
  }

  async function onAddMedia(files: UploadedMedia[]) {
    const room = limit === null ? files.length : Math.max(0, limit - images.length);
    const slice = files.slice(0, room);
    if (slice.length === 0) return;
    const res = await addImages(
      block.id,
      slice.map((file, i) => ({
        src: file.src,
        width: file.width,
        height: file.height,
        sort: images.length + i
      }))
    );
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      return;
    }
    await onReload();
  }

  return (
    <div id={`content-block-${block.id}`} className={collapsed ? "blk" : "blk on"}>
      <div className="bh" onClick={onToggle}>
        <span className="gr">⠿</span>
        <span className="kd">{presetName}</span>
        {chip ? <span className="c2">{chip}</span> : null}
        {save === "saving" ? <span className="c2">저장 중</span> : null}
        {save === "saved" ? <span className="c2">저장됨</span> : null}
        <div
          className="ct"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="ico" disabled={!canMoveUp} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="ico" disabled={!canMoveDown} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="ico" onClick={() => void onClone()}>
            ⧉
          </button>
          <button type="button" className="ico" onClick={() => setDeleteOpen(true)}>
            ✕
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="bb">
        <div className="space-y-4">
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{presetName}</span>
            <SmallBtn onClick={() => setChangePreset((v) => !v)}>배치 바꾸기</SmallBtn>
            <SmallBtn onClick={() => void onClone()}>복제</SmallBtn>
            <SmallBtn onClick={() => setDeleteOpen(true)}>삭제</SmallBtn>
          </div>

          {changePreset ? (
            <div className="flex flex-wrap gap-1">
              {ALL_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void onChangePreset(preset)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                    preset === block.preset
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-600"
                  }`}
                >
                  {PRESET_LABEL[preset]}
                </button>
              ))}
            </div>
          ) : null}

          {isFirstSection ? (
            <ToggleRow
              on={showMeta}
              title="기본정보 (사업분야 · 위치 · 클라이언트)"
              disabled={!showMeta && metaTakenByOther}
              onToggle={() => {
                const next = !showMeta;
                setShowMeta(next);
                void (async () => {
                  const ok = await persist({ show_meta: next });
                  if (ok) await onReload();
                  else setShowMeta(!next);
                })();
              }}
            />
          ) : null}

          {block.preset === "gallery-auto" ? (
            <div>
              <FieldLabel>줄 높이</FieldLabel>
              <input
                type="number"
                min={80}
                max={800}
                value={rowHeight}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setRowHeight(n);
                  schedule({ gallery_row_height: n });
                }}
                onBlur={() => void flush({ gallery_row_height: rowHeight })}
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <Guide>
                <GuideTerm anchorId="image-blocks">자동 배치 갤러리</GuideTerm>
                는 여러 장을 한 번에 올리면 가로 길이를 보고 줄을 나눕니다. 가로 이미지는 16:9 입니다.
              </Guide>
            </div>
          ) : null}

          {(IMAGE_TEXT_LIKE.has(block.preset)) ? (
            <div>
              <FieldLabel>글 위치</FieldLabel>
              <div className="flex gap-1.5">
                {(["left", "right"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => {
                      setTextSide(side);
                      void flush({ text_side: side });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      textSide === side
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {side === "left" ? "왼쪽" : "오른쪽"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {hasImages(block.preset) ? (
            <ImagesEditor
              images={images}
              preset={block.preset}
              blockId={block.id}
              siteUrl={siteUrl}
              uploadRoot={uploadRoot}
              atLimit={atLimit}
              limit={limit}
              onReload={onReload}
              onAdd={onAddMedia}
              onError={setError}
            />
          ) : null}

          {columnCount > 0 ? (
            <div>
              <FieldLabel>본문</FieldLabel>
              <div
                className={
                  columnCount === 3
                    ? "grid grid-cols-1 gap-3 lg:grid-cols-3"
                    : "grid grid-cols-1 gap-3 md:grid-cols-2"
                }
              >
                {columns.map((col, index) => (
                  <ColumnBodyField
                    key={index}
                    label={columnLabel(columnCount, index)}
                    value={col}
                    onKo={(v) => {
                      const next = columns.map((item, i) =>
                        i === index ? locField(item, "ko", v) : item
                      );
                      setColumns(next);
                      schedule({ body: { columns: next } });
                    }}
                    onEn={(v) => {
                      const next = columns.map((item, i) =>
                        i === index ? locField(item, "en", v) : item
                      );
                      setColumns(next);
                      schedule({ body: { columns: next } });
                    }}
                    onBlur={() => void flush({ body: { columns: columnsRef.current } })}
                  />
                ))}
              </div>
              <Guide>
                한 칸에 국문 60~120자. 칸끼리 길이를 비슷하게 맞추면 화면에서 높이가 어긋나지
                않습니다.
              </Guide>
            </div>
          ) : hasBody(block.preset) ? (
            <div>
              <FieldLabel>본문</FieldLabel>
              <BilingualField
                ko={body.ko}
                en={body.en}
                multiline
                onKo={(v) => {
                  const next = locField(body, "ko", v);
                  setBody(next);
                  schedule({ body: next });
                }}
                onEn={(v) => {
                  const next = locField(body, "en", v);
                  setBody(next);
                  schedule({ body: next });
                }}
                onBlur={() => void flush({ body })}
              />
              <Guide docLink>
                <b className="font-semibold text-slate-600">글꼴 · 자간 · 글자색은 없습니다.</b> 화면 스타일은 사이트가
                정합니다
                <Sep />
                한 문단은 <b className="font-semibold text-slate-600">국문 150자 이내</b>가 읽기 좋습니다. 그보다 길면
                문단을 나누세요.
                <br />
                소제목은 <b className="font-semibold text-slate-600">국문 20자 이내</b>. 소제목 아래 첫 문장에 결론을 쓰면
                AI가 그 덩어리를 인용합니다.
              </Guide>
            </div>
          ) : null}

          {block.preset === "video-full" || block.preset === "video-text" ? (
            <VideoFields
              kind={videoKind}
              url={videoUrl}
              poster={videoPoster}
              alt={videoAlt}
              uploadRoot={uploadRoot}
              blockId={block.id}
              siteUrl={siteUrl}
              onKind={(v) => {
                setVideoKind(v);
                setVideoUrl("");
                void flush({ video_kind: v, video_url: null });
              }}
              onUrl={(v) => {
                setVideoUrl(v);
                schedule({ video_url: v, video_kind: videoKind });
              }}
              onUrlBlur={() => void flush({ video_url: videoUrl, video_kind: videoKind })}
              onUrlCommit={(v) => {
                setVideoUrl(v);
                void flush({ video_url: v || null, video_kind: "hosted" });
              }}
              onPoster={async (src) => {
                const ok = await flush({ video_poster: src || null });
                if (ok) setVideoPoster(src);
                return ok;
              }}
              onAlt={(next) => {
                setVideoAlt(next);
                schedule({ video_alt: next });
              }}
              onAltBlur={() => void flush({ video_alt: videoAlt })}
            />
          ) : null}

          {block.preset === "embed" ? (
            <EmbedFields
              provider={embedProvider}
              url={embedUrl}
              title={embedTitle}
              poster={embedPoster}
              uploadRoot={uploadRoot}
              siteUrl={siteUrl}
              onProvider={setEmbedProvider}
              onUrl={setEmbedUrl}
              onConfirm={() => void flush({ embed_provider: embedProvider, embed_url: embedUrl })}
              onTitle={(next) => {
                setEmbedTitle(next);
                schedule({ embed_title: next });
              }}
              onTitleBlur={() => void flush({ embed_title: embedTitle })}
              onPoster={(src) => {
                setEmbedPoster(src);
                void flush({ embed_poster: src });
              }}
            />
          ) : null}
        </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="이 블록을 삭제할까요?"
        confirmText="삭제"
        danger
        onConfirm={() => onDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

const IMAGE_TEXT_LIKE = new Set(["image-text", "text-image", "portrait-text"]);

function columnLabel(count: number, index: number) {
  if (count === 2) return index === 0 ? "왼쪽" : "오른쪽";
  if (index === 0) return "왼쪽";
  if (index === 1) return "가운데";
  return "오른쪽";
}

function ColumnBodyField({
  label,
  value,
  onKo,
  onEn,
  onBlur,
  onAiFill,
  onGenerateEn
}: {
  label: string;
  value: Loc;
  onKo: (value: string) => void;
  onEn: (value: string) => void;
  onBlur: () => void;
  onAiFill?: () => void;
  onGenerateEn?: () => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <FieldLabel
        extra={
          <CharPair
            ko={value.ko.length}
            en={value.en.length}
            koLimit={120}
            enLimit={240}
            koWarn={60}
            enWarn={240}
          />
        }
      >
        {label}
      </FieldLabel>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <LangKo />
          <AiBtn disabled={!onAiFill} onClick={onAiFill}>
            ✦ AI로 채우기
          </AiBtn>
        </div>
        <TextArea value={value.ko} onChange={onKo} onBlur={onBlur} rows={5} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            <LangEn />
            <AiBadge />
          </span>
          <AiBtn disabled={!onGenerateEn} onClick={onGenerateEn}>
            ✦ 영문 생성
          </AiBtn>
        </div>
        <TextArea value={value.en} onChange={onEn} onBlur={onBlur} rows={5} ai />
      </div>
    </div>
  );
}

function ImagesEditor({
  images,
  preset,
  blockId,
  siteUrl,
  uploadRoot,
  atLimit,
  limit,
  onReload,
  onAdd,
  onError
}: {
  images: BlockImage[];
  preset: string;
  blockId: string;
  siteUrl: string;
  uploadRoot: string;
  atLimit: boolean;
  limit: number | null;
  onReload: () => Promise<void>;
  onAdd: (files: UploadedMedia[]) => void;
  onError: (msg: string | null) => void;
}) {

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= images.length) return;
    const order = images.map((img, i) => {
      if (i === index) return { id: img.id, sort: next };
      if (i === next) return { id: img.id, sort: index };
      return { id: img.id, sort: i };
    });
    const res = await reorderImages(blockId, order);
    if (!res.ok) onError(res.error);
    else await onReload();
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <div className="mb-2 text-xs font-bold text-slate-500">이미지 · {images.length}장</div>
      <Guide>
        {preset === "portrait-text" ? (
          <>
            <b className="font-semibold text-slate-600">{formatPortraitBodyImageHint()}</b>
            <Sep />
            세로 이미지입니다. 비율 검사는 하지 않습니다.
          </>
        ) : (
          <>
            <b className="font-semibold text-slate-600">{formatBodyImageHint()}</b>
            <Sep />
            {formatBodyImageRejectHint()}. 미리 잘라서 올려 주세요.
            <br />
            <b className="font-semibold text-slate-600">
              「<GuideTerm anchorId="image-blocks">가로 + 세로</GuideTerm>」「세로 + 가로」의 큰 쪽은 가로 사진
            </b>
            이어야 합니다. 가로 사진은 16:9. 작은 쪽만 높이에 맞춰 잘릴 수 있습니다.
          </>
        )}
      </Guide>
      <div className="mt-3 space-y-3">
        {images.map((img, i) => (
          <ImageRow
            key={img.id}
            image={img}
            blockId={blockId}
            siteUrl={siteUrl}
            canUp={i > 0}
            canDown={i < images.length - 1}
            onUp={() => void move(i, -1)}
            onDown={() => void move(i, 1)}
            onReload={onReload}
            onError={onError}
          />
        ))}
      </div>
      <div className="mt-3">
        <ImageUploader
          bucket="works"
          folder={`${uploadRoot}/blocks/${blockId}`}
          accept="image"
          multiple
          kind="body"
          bodyPreset={preset}
          disabled={atLimit}
          maxFiles={limit === null ? undefined : Math.max(0, limit - images.length)}
          existingNames={images.map((img) => fileName(img.src))}
          guide={
            atLimit
              ? `이 배치는 ${limit}장까지`
              : preset === "portrait-text"
                ? formatPortraitBodyImageHint()
                : (
                    <>
                      {formatBodyImageHint()}
                      <br />
                      {formatBodyImageRejectHint()}
                    </>
                  )
          }
          onUploaded={onAdd}
        />
      </div>
      <Guide>
        <GuideTerm anchorId="text-caption">대체 텍스트</GuideTerm> — 국문 40자 이내. 화면에 안 보입니다. 무엇이 찍혔는지
        사실만. 모든 이미지에 필수입니다.
        <br />
        <GuideTerm anchorId="text-caption">캡션</GuideTerm> — 국문 40~90자, 1~2문장.{" "}
        <b className="font-semibold text-slate-600">화면에 보입니다.</b> AI가 인용하는 것도 이쪽입니다. 말할 것이 있는
        이미지에만 켜세요. 워크 하나에 <b className="font-semibold text-slate-600">5~8장</b>이 적당합니다.
        <br />
        캡션에는 <b className="font-semibold text-slate-600">프로젝트 이름·기술·숫자</b>를 넣으세요. 좋은 예) 폭 23.5m
        미디어월. 15분마다 웰컴쇼가 재생됩니다. 나쁜 예) 아름다운 공간의 모습
      </Guide>
    </div>
  );
}

function ImageRow({
  image,
  blockId,
  siteUrl,
  canUp,
  canDown,
  onUp,
  onDown,
  onReload,
  onError
}: {
  image: BlockImage;
  blockId: string;
  siteUrl: string;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [alt, setAlt] = useState<Loc>(asLoc(image.alt));
  const [caption, setCaption] = useState<Loc>(asLoc(image.caption));
  const [visible, setVisible] = useState(image.caption_visible);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textDup = useTextDup();
  const debouncedAlt = useDebouncedValue(alt, 300);
  const debouncedCaption = useDebouncedValue(caption, 300);

  useEffect(() => {
    setAlt(asLoc(image.alt));
    setCaption(asLoc(image.caption));
    setVisible(image.caption_visible);
  }, [image]);

  useEffect(() => {
    textDup?.reportAlt(image.id, debouncedAlt);
  }, [image.id, debouncedAlt, textDup]);

  useEffect(() => {
    textDup?.reportCaption(image.id, debouncedCaption);
  }, [image.id, debouncedCaption, textDup]);

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 1500);
  }

  async function persist(patch: Record<string, unknown>) {
    const res = await updateImage(blockId, image.id, patch);
    if (!res.ok) onError(res.error);
  }

  async function remove() {
    const res = await deleteImage(blockId, image.id);
    if (!res.ok) onError(res.error);
    else await onReload();
  }

  const src = mediaUrl(siteUrl, image.src);
  const resLabel = [image.width && image.height ? `${image.width}×${image.height}` : "", formatBytes(null)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr]">
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-[10px] text-slate-400">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          fileName(image.src)
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="truncate font-medium text-slate-700">{fileName(image.src)}</span>
          {resLabel ? <span>{resLabel}</span> : null}
          <span className="flex-1" />
          <button type="button" disabled={!canUp} onClick={onUp} className="disabled:opacity-30">↑</button>
          <button type="button" disabled={!canDown} onClick={onDown} className="disabled:opacity-30">↓</button>
          <button type="button" onClick={() => void remove()} className="text-rose-600">삭제</button>
        </div>
        <div>
          <FieldLabel extra={<CharKo n={alt.ko.length} warn={40} limit={40} />}>대체 텍스트</FieldLabel>
          <BilingualField
            ko={alt.ko}
            en={alt.en}
            onKo={(v) => {
              const next = locField(alt, "ko", v);
              setAlt(next);
              schedule({ alt: next });
            }}
            onEn={(v) => {
              const next = locField(alt, "en", v);
              setAlt(next);
              schedule({ alt: next });
            }}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current);
              void persist({ alt });
            }}
            koFooter={
              <TextDupHint
                kind="alt"
                value={debouncedAlt.ko}
                count={textDup?.altDup(debouncedAlt.ko, "ko") ?? 0}
              />
            }
            enFooter={
              <TextDupHint
                kind="alt"
                value={debouncedAlt.en}
                count={textDup?.altDup(debouncedAlt.en, "en") ?? 0}
              />
            }
          />
        </div>
        <div>
          <FieldLabel extra={<CharKo n={caption.ko.length} warn={90} limit={90} />}>캡션</FieldLabel>
          <BilingualField
            ko={caption.ko}
            en={caption.en}
            multiline
            onKo={(v) => {
              const next = locField(caption, "ko", v);
              setCaption(next);
              schedule({ caption: next });
            }}
            onEn={(v) => {
              const next = locField(caption, "en", v);
              setCaption(next);
              schedule({ caption: next });
            }}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current);
              void persist({ caption });
            }}
            koFooter={
              <TextDupHint
                kind="caption"
                value={debouncedCaption.ko}
                count={textDup?.captionDup(debouncedCaption.ko, "ko") ?? 0}
                checkBlockName
              />
            }
            enFooter={
              <TextDupHint
                kind="caption"
                value={debouncedCaption.en}
                count={textDup?.captionDup(debouncedCaption.en, "en") ?? 0}
                checkBlockName
              />
            }
          />
        </div>
        <ToggleRow
          on={visible}
          title="화면에 캡션 표시"
          onToggle={() => {
            const next = !visible;
            setVisible(next);
            void persist({ caption_visible: next });
          }}
        />
        {image.ai_generated ? (
          <div className="flex items-center gap-2 text-xs text-apollon-700">
            <span>✦ {image.ai_confirmed ? "AI 확인됨" : "확인 전"}</span>
            {!image.ai_confirmed ? (
              <SmallBtn
                onClick={() => {
                  void (async () => {
                    await persist({ ai_confirmed: true });
                    await onReload();
                  })();
                }}
              >
                확인 완료
              </SmallBtn>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VideoFields({
  kind,
  url,
  poster,
  alt,
  uploadRoot,
  blockId,
  siteUrl,
  onKind,
  onUrl,
  onUrlBlur,
  onUrlCommit,
  onPoster,
  onAlt,
  onAltBlur
}: {
  kind: string;
  url: string;
  poster: string;
  alt: Loc;
  uploadRoot: string;
  blockId: string;
  siteUrl: string;
  onKind: (v: string) => void;
  onUrl: (v: string) => void;
  onUrlBlur: () => void;
  onUrlCommit: (v: string) => void;
  onPoster: (src: string) => void | Promise<boolean | void>;
  onAlt: (v: Loc) => void;
  onAltBlur: () => void;
}) {
  const textDup = useTextDup();
  const debouncedAlt = useDebouncedValue(alt, 300);
  useEffect(() => {
    textDup?.reportAlt(`video:${blockId}`, debouncedAlt);
  }, [blockId, debouncedAlt, textDup]);

  const isHosted = kind === "hosted" || kind === "loop";
  const previewSrc = url ? mediaUrl(siteUrl, url) : null;

  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [showPicker, setShowPicker] = useState(false);
  const [manualPoster, setManualPoster] = useState(false);
  const [posterBusy, setPosterBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [sourceStem, setSourceStem] = useState("video");
  const [pendingPickAfterUpload, setPendingPickAfterUpload] = useState(false);
  /** DB video_width / video_height 추가 후 PATCH에 실을 값 */
  const [, setVideoMeta] = useState<VideoFrameMeta | null>(null);
  const extractGen = useRef(0);
  const usedAlt = useRef(false);

  useEffect(() => {
    return () => {
      revokeFrameUrls(frames);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  function clearFrames() {
    setFrames((prev) => {
      revokeFrameUrls(prev);
      return [];
    });
  }

  async function runExtract(file: File, alt: boolean) {
    const gen = ++extractGen.current;
    setExtracting(true);
    setExtractFailed(false);
    setPickError(null);
    setExtractProgress({ done: 0, total: 1 });
    clearFrames();
    const fn = alt ? extractFramesAlt : extractFrames;
    const next = await fn(file, 5, (meta) => {
      if (gen === extractGen.current) setVideoMeta(meta);
    }, (done, total) => {
      if (gen === extractGen.current) setExtractProgress({ done, total });
    });
    if (gen !== extractGen.current) {
      revokeFrameUrls(next);
      return;
    }
    setFrames(next);
    setExtracting(false);
    setExtractProgress(null);
    if (next.length === 0) {
      setExtractFailed(true);
      setShowPicker(false);
      setManualPoster(true);
    } else {
      setExtractFailed(false);
      setShowPicker(true);
    }
  }

  function onVideoUploaded(files: UploadedMedia[]) {
    const first = files[0];
    if (!first) return;
    onUrlCommit(first.src);
    if (!poster && pendingPickAfterUpload) {
      setShowPicker(true);
    }
    setPendingPickAfterUpload(false);
  }

  async function uploadPosterBlob(blob: Blob, at: number) {
    setPosterBusy(true);
    setPickError(null);
    try {
      const sec = Math.floor(at);
      const filename = sanitizeUploadFilename(`${sourceStem}-poster-${sec}.jpg`);
      const path = uploadObjectPath(`${uploadRoot}/poster`, filename);
      const file = new File([blob], filename, { type: "image/jpeg" });
      const res = await uploadFile(file, "works", path);
      if (!res.ok) {
        setPickError(res.error || "올리지 못했습니다");
        return;
      }
      const src = res.data.publicUrl || `/${res.data.path}`;
      const saved = await onPoster(src);
      if (saved === false) {
        setPickError("저장하지 못했습니다");
        return;
      }
      setShowPicker(false);
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "저장하지 못했습니다");
    } finally {
      setPosterBusy(false);
    }
  }

  const [localFile, setLocalFile] = useState<File | null>(null);

  async function runExtractKeepFile(file: File, alt: boolean) {
    setLocalFile(file);
    usedAlt.current = alt;
    await runExtract(file, alt);
  }

  function onLocalVideoKeep(files: File[]) {
    const file = files[0];
    if (!file) return;
    const stem = file.name.replace(/\.[^.]+$/, "") || "video";
    setSourceStem(stem);
    setManualPoster(false);
    setExtractFailed(false);
    setPickError(null);
    setPendingPickAfterUpload(!poster);
    setShowPicker(true);
    usedAlt.current = false;
    void runExtractKeepFile(file, false);
  }

  function handleRedraw() {
    if (!localFile) return;
    const nextAlt = !usedAlt.current;
    setShowPicker(true);
    void runExtractKeepFile(localFile, nextAlt);
  }

  function reopenPicker() {
    setManualPoster(false);
    setPickError(null);
    if (frames.length > 0) {
      setShowPicker(true);
      return;
    }
    if (localFile) {
      setShowPicker(true);
      void runExtractKeepFile(localFile, usedAlt.current);
      return;
    }
    setManualPoster(true);
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        <KindChip on={kind === "embed"} onClick={() => onKind("embed")}>
          임베드
        </KindChip>
        <KindChip on={isHosted} onClick={() => onKind("hosted")}>
          영상 업로드
        </KindChip>
      </div>

      {isHosted ? (
        <div>
          <FieldLabel>영상 파일</FieldLabel>
          <ImageUploader
            bucket="works"
            folder={`${uploadRoot}/blocks/${blockId}`}
            accept="video"
            multiple={false}
            siteUrl={siteUrl}
            value={url || null}
            guide={
              <>
                {formatDetailMovieHint()} · 클릭하면 재생됩니다.
                <br />
                더 큰 영상은 유튜브에 올리고 주소를 붙여넣는 편이 낫습니다.
              </>
            }
            onLocalFiles={onLocalVideoKeep}
            onUploaded={onVideoUploaded}
            onClear={() => {
              onUrlCommit("");
              clearFrames();
              setLocalFile(null);
              setShowPicker(false);
              setExtractFailed(false);
              setManualPoster(false);
              setPickError(null);
              setVideoMeta(null);
            }}
          />
          {previewSrc ? (
            <video
              src={previewSrc}
              muted
              controls
              playsInline
              className="mt-2 max-h-48 w-full rounded-md bg-black object-contain"
            />
          ) : null}

          {extracting || showPicker || extractFailed ? (
            <PosterPicker
              frames={frames}
              extracting={extracting}
              failed={extractFailed}
              busy={posterBusy}
              progress={extractProgress}
              error={pickError}
              onPick={(blob, at) => void uploadPosterBlob(blob, at)}
              onUpload={() => {
                setManualPoster(true);
                setShowPicker(false);
                setExtractFailed(false);
                setPickError(null);
              }}
              onRedraw={localFile ? handleRedraw : undefined}
            />
          ) : null}

          {url && !showPicker && !extracting && !extractFailed ? (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-apollon-700 underline"
              onClick={reopenPicker}
            >
              재생 전 이미지 다시 고르기
            </button>
          ) : null}
        </div>
      ) : (
        <TextInput
          value={url}
          onChange={onUrl}
          onBlur={onUrlBlur}
          placeholder="유튜브 · Vimeo · Behance 주소"
        />
      )}

      <div className="mt-2">
        <FieldLabel>재생 전 이미지</FieldLabel>
        {isHosted && !manualPoster && !poster && !extractFailed && (extracting || showPicker) ? (
          <p className="text-xs text-slate-500">위에서 장면을 고르거나 직접 올리기를 선택하세요.</p>
        ) : (
          <ImageUploader
            bucket="works"
            folder={`${uploadRoot}/poster`}
            accept="image"
            multiple={false}
            kind="poster"
            siteUrl={siteUrl}
            value={poster || null}
            guide={
              isHosted
                ? "필수. 없으면 재생 전에 검은 화면이 보입니다"
                : "비워두면 유튜브 썸네일을 자동으로 가져옵니다"
            }
            onUploaded={async (files) => {
              const first = files[0];
              if (!first) return;
              const ok = await onPoster(first.src);
              if (ok === false) return;
              setShowPicker(false);
              setManualPoster(false);
            }}
            onClear={() => void onPoster("")}
          />
        )}
      </div>
      <div className="mt-2">
        <FieldLabel>대체 텍스트</FieldLabel>
        <BilingualField
          ko={alt.ko}
          en={alt.en}
          onKo={(v) => onAlt(locField(alt, "ko", v))}
          onEn={(v) => onAlt(locField(alt, "en", v))}
          onBlur={onAltBlur}
          koFooter={
            <TextDupHint
              kind="alt"
              value={debouncedAlt.ko}
              count={textDup?.altDup(debouncedAlt.ko, "ko") ?? 0}
            />
          }
          enFooter={
            <TextDupHint
              kind="alt"
              value={debouncedAlt.en}
              count={textDup?.altDup(debouncedAlt.en, "en") ?? 0}
            />
          }
        />
      </div>
      <Guide>
        {isHosted ? (
          <>
            <GuideTerm anchorId="video-main">{VIDEO_LABELS.detailMovie}</GuideTerm> —{" "}
            <b className="font-semibold text-slate-600">{formatDetailMovieHint()}.</b> 클릭하면 재생됩니다.{" "}
            <GuideTerm anchorId="video-export">비트레이트</GuideTerm> 2Mbps 이하를 권장합니다.
            <br />
            목록 카드에서 마우스를 올리면 도는{" "}
            <GuideTerm anchorId="video-loop">배경 루프</GuideTerm>는 기본정보 탭에서 따로 올립니다.
            <br />
            <GuideTerm anchorId="video-main">재생 전 이미지</GuideTerm>가 없으면 재생 전에 검은 화면이 보입니다.
          </>
        ) : (
          <>
            유튜브 · Vimeo · Behance 주소를 그대로 붙여넣으세요.
            <br />
            재생 버튼을 누르기 전까지는{" "}
            <GuideTerm anchorId="video-main">재생 전 이미지</GuideTerm> 한 장만 보이므로 페이지가 가볍습니다.
          </>
        )}
      </Guide>
    </div>
  );
}

function EmbedFields({
  provider,
  url,
  title,
  poster,
  uploadRoot,
  siteUrl,
  onProvider,
  onUrl,
  onConfirm,
  onTitle,
  onTitleBlur,
  onPoster
}: {
  provider: string;
  url: string;
  title: Loc;
  poster: string;
  uploadRoot: string;
  siteUrl: string;
  onProvider: (v: string) => void;
  onUrl: (v: string) => void;
  onConfirm: () => void;
  onTitle: (v: Loc) => void;
  onTitleBlur: () => void;
  onPoster: (src: string) => void;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>제공자</FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {EMBED_PROVIDERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onProvider(item.id)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              provider === item.id
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <TextInput value={url} onChange={onUrl} placeholder="임베드 주소" />
        </div>
        <GhostBtn onClick={onConfirm}>확인</GhostBtn>
      </div>
      <p className="text-xs text-slate-400">허용 목록</p>
      <div className="flex flex-wrap gap-1">
        {EMBED_PROVIDERS.map((item) => (
          <span key={item.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            {item.label}
          </span>
        ))}
      </div>
      <FieldLabel>제목</FieldLabel>
      <BilingualField
        ko={title.ko}
        en={title.en}
        onKo={(v) => onTitle(locField(title, "ko", v))}
        onEn={(v) => onTitle(locField(title, "en", v))}
        onBlur={onTitleBlur}
      />
      <FieldLabel>재생 전 이미지</FieldLabel>
      <ImageUploader
        bucket="works"
        folder={`${uploadRoot}/poster`}
        accept="image"
        multiple={false}
        kind="poster"
        siteUrl={siteUrl}
        value={poster || null}
        guide="재생 전에 보이는 이미지"
        onUploaded={(files) => {
          const first = files[0];
          if (first) onPoster(first.src);
        }}
        onClear={() => onPoster("")}
      />
    </div>
  );
}

function KindChip({
  on,
  onClick,
  disabled,
  children
}: {
  on: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[11px] ${
        on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
