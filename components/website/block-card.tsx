"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Copy,
  GripVertical,
  MoreHorizontal,
  Trash2
} from "lucide-react";
import {
  addImages,
  createBlock,
  createLibrary,
  deleteBlock,
  deleteImage,
  reorderImages,
  updateBlock,
  updateImage
} from "@/lib/website/api";
import { supabase } from "@/lib/supabase/client";
import type { BlockImage, ContentBlock, Loc } from "@/lib/website/work-detail";
import { asLoc, fileName, mediaUrl } from "@/lib/website/work-detail";
import {
  ALL_PRESETS,
  defaultTextSide,
  EMBED_PROVIDERS,
  hasBody,
  hasImages,
  imageLimitForPreset,
  PRESET_LABEL
} from "@/components/website/block-presets";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { PreviewMiniBtn, PreviewModal } from "@/components/website/preview-modal";
import {
  BilingualField,
  CharKo,
  FieldLabel,
  GhostBtn,
  Guide,
  locField,
  Sep,
  SmallBtn,
  TextInput,
  ToggleRow
} from "@/components/website/work-editor-ui";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  block: ContentBlock;
  index: number;
  total: number;
  sectionId: string;
  workId: string;
  siteUrl: string;
  onReload: () => Promise<void>;
  onMove: (dir: -1 | 1) => void;
  collapsed: boolean;
  onToggle: () => void;
};

function formatBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

async function currentUserName() {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const meta = session?.user?.user_metadata ?? {};
  if (typeof meta.name === "string" && meta.name.trim()) return meta.name.trim();
  return session?.user?.email ?? "";
}

export function BlockCard({
  block,
  index,
  total,
  sectionId,
  workId,
  siteUrl,
  onReload,
  onMove,
  collapsed,
  onToggle
}: Props) {
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [changePreset, setChangePreset] = useState(false);
  const [saveLib, setSaveLib] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [body, setBody] = useState<Loc>(asLoc(block.body));
  const [videoKind, setVideoKind] = useState(block.video_kind ?? "embed");
  const [videoUrl, setVideoUrl] = useState(block.video_url ?? "");
  const [videoPoster, setVideoPoster] = useState(block.video_poster ?? "");
  const [videoAlt, setVideoAlt] = useState<Loc>(asLoc(block.video_alt));
  const [embedProvider, setEmbedProvider] = useState(block.embed_provider ?? "youtube");
  const [embedUrl, setEmbedUrl] = useState(block.embed_url ?? "");
  const [embedTitle, setEmbedTitle] = useState<Loc>(asLoc(block.embed_title));
  const [embedPoster, setEmbedPoster] = useState(block.embed_poster ?? "");
  const [rowHeight, setRowHeight] = useState(block.gallery_row_height ?? 320);
  const [textSide, setTextSide] = useState<"left" | "right">(block.text_side ?? defaultTextSide(block.preset));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBody(asLoc(block.body));
    setVideoKind(block.video_kind ?? "embed");
    setVideoUrl(block.video_url ?? "");
    setVideoPoster(block.video_poster ?? "");
    setVideoAlt(asLoc(block.video_alt));
    setEmbedProvider(block.embed_provider ?? "youtube");
    setEmbedUrl(block.embed_url ?? "");
    setEmbedTitle(asLoc(block.embed_title));
    setEmbedPoster(block.embed_poster ?? "");
    setRowHeight(block.gallery_row_height ?? 320);
    setTextSide(block.text_side ?? defaultTextSide(block.preset));
  }, [block]);

  const images = [...(block.block_images ?? [])].sort((a, b) => a.sort - b.sort);
  const limit = imageLimitForPreset(block.preset);
  const atLimit = limit !== null && images.length >= limit;
  const presetName = PRESET_LABEL[block.preset] ?? block.preset;
  const mediaLabel = [
    images.length ? `이미지 ${images.length}` : "",
    block.preset.startsWith("video") ? "영상" : "",
    block.preset === "embed" ? "임베드" : ""
  ]
    .filter(Boolean)
    .join(" · ");

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 1500);
  }

  async function persist(patch: Record<string, unknown>) {
    setSave("saving");
    setError(null);
    try {
      const res = await updateBlock(sectionId, block.id, patch);
      if (!res.ok) {
        setSave("error");
        setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
        return;
      }
      setSave("saved");
    } finally {
      setSave((cur) => (cur === "saving" ? "idle" : cur));
    }
  }

  async function flush(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    await persist(patch);
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        <span className="rounded bg-slate-400 px-1.5 py-0.5 text-[10px] font-bold text-white">{index}</span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 truncate text-left text-sm font-bold text-slate-800">
          {presetName}
        </button>
        {mediaLabel ? <span className="hidden text-xs text-slate-400 sm:inline">{mediaLabel}</span> : null}
        <PreviewMiniBtn onClick={() => setPreviewOpen(true)} />
        {save === "saving" ? <span className="text-[11px] text-slate-400">저장 중</span> : null}
        {save === "saved" ? <span className="text-[11px] text-emerald-600">저장됨</span> : null}
        <button type="button" disabled={index <= 1} onClick={() => onMove(-1)} className="text-xs text-slate-400 disabled:opacity-30">
          ↑
        </button>
        <button type="button" disabled={index >= total} onClick={() => onMove(1)} className="text-xs text-slate-400 disabled:opacity-30">
          ↓
        </button>
        <div className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} className="text-slate-400">
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu ? (
            <div className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setMenu(false); void onClone(); }}>
                <Copy className="h-3 w-3" /> 복제
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50" onClick={() => { setMenu(false); setDeleteOpen(true); }}>
                <Trash2 className="h-3 w-3" /> 삭제
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={onToggle} className="text-slate-400">
          <ChevronDown className={`h-4 w-4 transition ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>

      {collapsed ? null : (
        <div className="space-y-4 p-3.5">
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{presetName}</span>
            <SmallBtn onClick={() => setChangePreset((v) => !v)}>배치 바꾸기</SmallBtn>
            <SmallBtn onClick={() => setSaveLib(true)}>라이브러리에 저장</SmallBtn>
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
              <Guide>여러 장을 한 번에 올리면 비율을 보고 알아서 줄을 나눕니다</Guide>
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
              blockId={block.id}
              preset={block.preset}
              siteUrl={siteUrl}
              workId={workId}
              atLimit={atLimit}
              limit={limit}
              onReload={onReload}
              onAdd={onAddMedia}
              onError={setError}
            />
          ) : null}

          {hasBody(block.preset) ? (
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
              <Guide>
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
              workId={workId}
              onKind={(v) => {
                setVideoKind(v);
                void flush({ video_kind: v });
              }}
              onUrl={(v) => {
                setVideoUrl(v);
                schedule({ video_url: v, video_kind: videoKind });
              }}
              onUrlBlur={() => void flush({ video_url: videoUrl, video_kind: videoKind })}
              onPoster={(src) => {
                setVideoPoster(src);
                void flush({ video_poster: src });
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
              workId={workId}
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

          {saveLib ? (
            <SaveLibraryModal
              block={block}
              images={images}
              onClose={() => setSaveLib(false)}
            />
          ) : null}
        </div>
      )}

      {previewOpen ? (
        <PreviewModal
          workId={workId}
          blockId={block.id}
          title={presetName}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

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

function ImagesEditor({
  images,
  blockId,
  preset,
  siteUrl,
  workId,
  atLimit,
  limit,
  onReload,
  onAdd,
  onError
}: {
  images: BlockImage[];
  blockId: string;
  preset: string;
  siteUrl: string;
  workId: string;
  atLimit: boolean;
  limit: number | null;
  onReload: () => Promise<void>;
  onAdd: (files: UploadedMedia[]) => void;
  onError: (msg: string | null) => void;
}) {
  const multi = preset === "gallery-auto" || preset === "carousel";

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
        <b className="font-semibold text-slate-600">JPG</b> · 긴 변{" "}
        <b className="font-semibold text-slate-600">2560px</b> ·{" "}
        <b className="font-semibold text-slate-600">2MB 이하</b> ·{" "}
        <b className="font-semibold text-slate-600">비율 자유</b>
        <Sep />
        본문 이미지는 가로·세로·정사각형 아무거나 됩니다. 올린 비율 그대로 들어갑니다.
        <br />
        <b className="font-semibold text-slate-600">2단 2:1 · 1:2 배치의 작은 쪽은 세로형(3:4)</b>이 어울립니다. 가로
        사진을 넣으면 좌우가 잘립니다.
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
          workId={workId}
          accept="image"
          multiple={multi}
          disabled={atLimit}
          maxFiles={limit === null ? undefined : Math.max(0, limit - images.length)}
          label={atLimit ? `이 배치는 ${limit}장까지` : "＋ 이미지 추가"}
          onUploaded={onAdd}
        />
      </div>
      <Guide>
        <b className="font-semibold text-slate-600">대체 텍스트</b> — 국문 40자 이내. 화면에 안 보입니다. 무엇이 찍혔는지
        사실만. 모든 이미지에 필수입니다.
        <br />
        <b className="font-semibold text-slate-600">캡션</b> — 국문 40~90자, 1~2문장.{" "}
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

  useEffect(() => {
    setAlt(asLoc(image.alt));
    setCaption(asLoc(image.caption));
    setVisible(image.caption_visible);
  }, [image]);

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
  workId,
  onKind,
  onUrl,
  onUrlBlur,
  onPoster,
  onAlt,
  onAltBlur
}: {
  kind: string;
  url: string;
  poster: string;
  alt: Loc;
  workId: string;
  onKind: (v: string) => void;
  onUrl: (v: string) => void;
  onUrlBlur: () => void;
  onPoster: (src: string) => void;
  onAlt: (v: Loc) => void;
  onAltBlur: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        <KindChip on={kind === "embed"} onClick={() => onKind("embed")}>
          유튜브·Behance 임베드
        </KindChip>
        <KindChip on={kind === "loop"} onClick={() => onKind("loop")}>
          배경 루프 업로드
        </KindChip>
        <KindChip on={false} disabled>
          본편 영상 (9월 예정)
        </KindChip>
      </div>
      {kind === "loop" ? (
        <ImageUploader
          workId={workId}
          accept="video"
          kind="loop-lg"
          label="＋ 루프 영상 업로드"
          onUploaded={(files) => {
            const first = files[0];
            if (first) onUrl(first.src);
          }}
        />
      ) : (
        <TextInput value={url} onChange={onUrl} onBlur={onUrlBlur} placeholder="영상 주소" />
      )}
      <div className="mt-2">
        <FieldLabel>재생 전 이미지</FieldLabel>
        <ImageUploader
          workId={workId}
          accept="image"
          kind="poster"
          label={poster ? "재생 전 이미지 바꾸기" : "＋ 재생 전 이미지"}
          onUploaded={(files) => {
            const first = files[0];
            if (first) onPoster(first.src);
          }}
        />
      </div>
      <div className="mt-2">
        <FieldLabel>대체 텍스트</FieldLabel>
        <BilingualField
          ko={alt.ko}
          en={alt.en}
          onKo={(v) => onAlt(locField(alt, "ko", v))}
          onEn={(v) => onAlt(locField(alt, "en", v))}
          onBlur={onAltBlur}
        />
      </div>
      <Guide>
        <b className="font-semibold text-slate-600">임베드</b> — 유튜브·Behance 주소를 그대로 붙여넣으세요. 재생 버튼을
        누르기 전까지는 이미지 한 장만 보이므로 페이지가 무거워지지 않습니다.
        <br />
        <b className="font-semibold text-slate-600">배경 루프</b> — MP4(H.264) · 1280×720 · 4~6초 · 24fps · 소리 없음 ·{" "}
        <b className="font-semibold text-slate-600">1.5MB 이하</b>. 마우스를 올리면 재생되고, 모바일에서는 정지 이미지로
        대체됩니다.
        <br />
        <b className="font-semibold text-slate-600">본편 영상</b> — 9월 예정. 유튜브에 올리지 않을 고화질 영상을 우리
        서버에서 재생합니다.
      </Guide>
    </div>
  );
}

function EmbedFields({
  provider,
  url,
  title,
  poster,
  workId,
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
  workId: string;
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
        workId={workId}
        accept="image"
        kind="poster"
        label={poster ? "재생 전 이미지 바꾸기" : "＋ 재생 전 이미지"}
        onUploaded={(files) => {
          const first = files[0];
          if (first) onPoster(first.src);
        }}
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

function SaveLibraryModal({
  block,
  images,
  onClose
}: {
  block: ContentBlock;
  images: BlockImage[];
  onClose: () => void;
}) {
  const [name, setName] = useState(PRESET_LABEL[block.preset] ?? block.preset);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const createdBy = await currentUserName();
      const config: Record<string, unknown> = {
        caption_visible: images.some((img) => img.caption_visible)
      };
      if (block.gallery_row_height != null) config.gallery_row_height = block.gallery_row_height;
      if (block.text_side) config.text_side = block.text_side;
      const res = await createLibrary({
        name,
        description: description.trim() || null,
        preset: block.preset,
        config,
        created_by: createdBy
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <h3 className="text-sm font-bold text-slate-900">라이브러리에 저장</h3>
        <p className="mt-1 text-xs text-slate-500">배치만 저장합니다. 이미지·글 내용은 담지 않습니다.</p>
        <div className="mt-3 space-y-2">
          <FieldLabel>이름</FieldLabel>
          <TextInput value={name} onChange={setName} />
          <FieldLabel>설명</FieldLabel>
          <TextInput value={description} onChange={setDescription} />
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <GhostBtn onClick={onClose}>취소</GhostBtn>
          <GhostBtn disabled={busy || !name.trim()} onClick={() => void submit()}>
            저장
          </GhostBtn>
        </div>
      </div>
    </div>
  );
}
