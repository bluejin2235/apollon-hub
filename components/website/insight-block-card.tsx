"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { InsightTextEditor } from "@/components/website/insight-text-editor";
import { Field } from "@/components/website/ui";
import { locField, TextInput } from "@/components/website/work-editor-ui";
import { imageLimitForPreset } from "@/components/website/block-presets";
import {
  addInsightImages,
  createInsightBlock,
  deleteInsightBlock,
  deleteInsightImage,
  updateInsightBlock,
  updateInsightImage
} from "@/lib/website/api";
import type { InsightBlock } from "@/lib/website/insight-detail";
import { asLoc, fileName, mediaUrl, type Loc } from "@/lib/website/work-detail";

const PRESET_LABEL: Record<string, string> = {
  text: "글",
  qa: "질문 · 답변",
  full: "전폭 이미지",
  split: "2단 나란히",
  triple: "3단 나란히",
  "gallery-auto": "자동 배치 갤러리",
  carousel: "가로 스크롤",
  "video-full": "영상 전폭",
  embed: "임베드"
};

function insightImageLimit(preset: string): number | null {
  if (preset === "text" || preset === "qa" || preset === "video-full" || preset === "embed") return 0;
  return imageLimitForPreset(preset);
}

type Props = {
  block: InsightBlock;
  insightId: string;
  uploadRoot: string;
  siteUrl: string;
  locale: "ko" | "en";
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onReload: () => Promise<void>;
};

export function InsightBlockCard({
  block,
  insightId,
  uploadRoot,
  siteUrl,
  locale,
  canMoveUp,
  canMoveDown,
  onMove,
  onReload
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [body, setBody] = useState<Loc>(asLoc(block.body));
  const [question, setQuestion] = useState<Loc>(asLoc(block.question));
  const [answer, setAnswer] = useState<Loc>(asLoc(block.answer));
  const [videoUrl, setVideoUrl] = useState(block.video_url ?? "");
  const [embedUrl, setEmbedUrl] = useState(block.embed_url ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBody(asLoc(block.body));
    setQuestion(asLoc(block.question));
    setAnswer(asLoc(block.answer));
    setVideoUrl(block.video_url ?? "");
    setEmbedUrl(block.embed_url ?? "");
  }, [block]);

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 800);
  }

  async function persist(patch: Record<string, unknown>) {
    setSave("saving");
    const res = await updateInsightBlock(insightId, block.id, patch);
    if (!res.ok) {
      setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
      setSave("idle");
      return;
    }
    setSave("saved");
    window.setTimeout(() => setSave("idle"), 1200);
  }

  async function onClone() {
    const res = await createInsightBlock(insightId, {
      preset: block.preset,
      sort: block.sort + 1,
      body: block.body,
      question: block.question,
      answer: block.answer,
      video_kind: block.video_kind,
      video_url: block.video_url,
      poster: block.poster,
      embed_provider: block.embed_provider,
      embed_url: block.embed_url,
      embed_note: block.embed_note
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const newId = (res.data as { id?: string }).id;
    const images = [...(block.insight_images ?? [])].sort((a, b) => a.sort - b.sort);
    if (newId && images.length > 0) {
      await addInsightImages(
        newId,
        images.map((image, i) => ({
          src: image.src,
          width: image.width,
          height: image.height,
          alt: image.alt,
          caption: image.caption,
          caption_visible: image.caption_visible,
          sort: i
        }))
      );
    }
    await onReload();
  }

  async function onDelete() {
    const res = await deleteInsightBlock(insightId, block.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onReload();
  }

  const images = [...(block.insight_images ?? [])].sort((a, b) => a.sort - b.sort);
  const limit = insightImageLimit(block.preset);
  const atLimit = limit !== null && images.length >= limit;
  const name = PRESET_LABEL[block.preset] ?? block.preset;

  return (
    <div className="blk on">
      <div className="bh">
        <span className="gr">⠿</span>
        <span className="kd">{name}</span>
        {save === "saving" ? <span className="c2">저장 중</span> : null}
        {save === "saved" ? <span className="c2">저장됨</span> : null}
        <div className="ct">
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
      <div className="bb space-y-3">
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}

        {block.preset === "text" ? (
          <InsightTextEditor
            value={body[locale]}
            onChange={(html) => {
              const next = locField(body, locale, html);
              setBody(next);
              schedule({ body: next });
            }}
            onBlur={() => {
              if (timer.current) clearTimeout(timer.current);
              void persist({ body });
            }}
          />
        ) : null}

        {block.preset === "qa" ? (
          <>
            <Field label="질문" required>
              <TextInput
                value={question[locale]}
                onChange={(v) => {
                  const next = locField(question, locale, v);
                  setQuestion(next);
                  schedule({ question: next });
                }}
                onBlur={() => {
                  if (timer.current) clearTimeout(timer.current);
                  void persist({ question, answer });
                }}
              />
            </Field>
            <Field label="답변" required>
              <textarea
                className="i"
                style={{ minHeight: 60 }}
                value={answer[locale]}
                onChange={(e) => {
                  const next = locField(answer, locale, e.target.value);
                  setAnswer(next);
                  schedule({ answer: next });
                }}
                onBlur={() => {
                  if (timer.current) clearTimeout(timer.current);
                  void persist({ question, answer });
                }}
              />
            </Field>
            <p className="text-[11px] text-slate-400">인터뷰에 쓰는 블록입니다. 질문과 답변이 나뉘어 저장됩니다.</p>
          </>
        ) : null}

        {limit !== 0 ? (
          <InsightImages
            images={images}
            blockId={block.id}
            siteUrl={siteUrl}
            uploadRoot={uploadRoot}
            atLimit={atLimit}
            locale={locale}
            onReload={onReload}
            onError={setError}
          />
        ) : null}

        {block.preset === "video-full" ? (
          <Field label="영상 주소">
            <TextInput
              value={videoUrl}
              onChange={setVideoUrl}
              onBlur={() => void persist({ video_kind: block.video_kind || "embed", video_url: videoUrl })}
            />
          </Field>
        ) : null}

        {block.preset === "embed" ? (
          <Field label="임베드 주소">
            <TextInput
              value={embedUrl}
              onChange={setEmbedUrl}
              onBlur={() => void persist({ embed_provider: block.embed_provider || "youtube", embed_url: embedUrl })}
            />
          </Field>
        ) : null}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="이 블록을 삭제할까요?"
        confirmText="삭제"
        danger
        onConfirm={() => void onDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

function InsightImages({
  images,
  blockId,
  siteUrl,
  uploadRoot,
  atLimit,
  locale,
  onReload,
  onError
}: {
  images: NonNullable<InsightBlock["insight_images"]>;
  blockId: string;
  siteUrl: string;
  uploadRoot: string;
  atLimit: boolean;
  locale: "ko" | "en";
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  async function onAdd(files: UploadedMedia[]) {
    if (files.length === 0) return;
    const res = await addInsightImages(
      blockId,
      files.map((file, i) => ({
        src: file.src,
        width: file.width,
        height: file.height,
        sort: images.length + i
      }))
    );
    if (!res.ok) {
      onError(res.error);
      return;
    }
    await onReload();
  }

  return (
    <div className="space-y-3">
      {images.map((image) => {
        const src = mediaUrl(siteUrl, image.src);
        return (
          <InsightImageRow
            key={image.id}
            src={src}
            name={fileName(image.src)}
            image={image}
            blockId={blockId}
            locale={locale}
            onReload={onReload}
            onError={onError}
          />
        );
      })}
      {atLimit ? null : (
        <ImageUploader
          bucket="insights"
          folder={`${uploadRoot}/blocks`}
          accept="image"
          multiple
          siteUrl={siteUrl}
          onUploaded={(files) => void onAdd(files)}
        />
      )}
    </div>
  );
}

function InsightImageRow({
  src,
  name,
  image,
  blockId,
  locale,
  onReload,
  onError
}: {
  src: string | null;
  name: string;
  image: NonNullable<InsightBlock["insight_images"]>[number];
  blockId: string;
  locale: "ko" | "en";
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [alt, setAlt] = useState<Loc>(asLoc(image.alt));
  const [caption, setCaption] = useState<Loc>(asLoc(image.caption));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAlt(asLoc(image.alt));
    setCaption(asLoc(image.caption));
  }, [image]);

  function schedule(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 800);
  }

  async function persist(patch: Record<string, unknown>) {
    const res = await updateInsightImage(blockId, image.id, patch);
    if (!res.ok) onError(res.error);
  }

  return (
    <div className="flex gap-3">
      <div className="h-24 w-[180px] shrink-0 overflow-hidden rounded bg-slate-100">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-[10.5px] text-slate-400">
          <span className="truncate">{name}</span>
          {image.width && image.height ? <span>{image.width} × {image.height}</span> : null}
          <button
            type="button"
            className="ml-auto text-rose-600"
            onClick={() => void deleteInsightImage(blockId, image.id).then((res) => (res.ok ? onReload() : onError(res.error)))}
          >
            삭제
          </button>
        </div>
        <Field label="대체 텍스트">
          <TextInput
            value={alt[locale]}
            onChange={(v) => {
              const next = locField(alt, locale, v);
              setAlt(next);
              schedule({ alt: next });
            }}
          />
        </Field>
        <Field label="캡션">
          <TextInput
            value={caption[locale]}
            onChange={(v) => {
              const next = locField(caption, locale, v);
              setCaption(next);
              schedule({ caption: next });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
