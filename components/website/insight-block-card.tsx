"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { LeadHtmlModal } from "@/components/website/lead-html-modal";
import {
  PartialSaveBtn,
  type PartialSaveState
} from "@/components/website/partial-save-btn";
import { Field } from "@/components/website/ui";
import { locField, TextInput, ToggleRow } from "@/components/website/work-editor-ui";
import { imageLimitForPreset } from "@/components/website/block-presets";
import {
  addInsightImages,
  createInsightBlock,
  deleteInsightBlock,
  deleteInsightImage,
  updateInsight,
  updateInsightBlock,
  updateInsightImage
} from "@/lib/website/api";
import {
  insightCharCount,
  insightIsEmpty,
  insightLooksLikeHtml,
  insightToEditorHtml,
  sanitizeInsightHtml
} from "@/lib/website/insight-html";
import type { InsightBlock } from "@/lib/website/insight-detail";
import { asLoc, fileName, mediaUrl, type Loc } from "@/lib/website/work-detail";

const PRESET_LABEL: Record<string, string> = {
  text: "글",
  qa: "질문 · 답변",
  full: "전폭 이미지",
  split: "2단 나란히",
  triple: "3단 나란히",
  "gallery-auto": "자동 배치 갤러리",
  stack: "위아래 두 장",
  carousel: "가로 스크롤",
  "video-full": "영상 전폭",
  embed: "임베드"
};

/** 글 계열 → accent, 이미지 → pro, 영상·임베드 → success */
function familyClass(preset: string): "fam-accent" | "fam-pro" | "fam-success" {
  if (preset === "text" || preset === "qa") return "fam-accent";
  if (preset === "video-full" || preset === "embed") return "fam-success";
  return "fam-pro";
}

function insightImageLimit(preset: string): number | null {
  if (preset === "text" || preset === "qa" || preset === "video-full" || preset === "embed") {
    return 0;
  }
  return imageLimitForPreset(preset);
}

function orderLabel(index: number, name: string) {
  return `${String(index).padStart(2, "0")} · ${name}`;
}

type SaveState = PartialSaveState | "error";

type Props = {
  block: InsightBlock;
  index: number;
  insightId: string;
  uploadRoot: string;
  siteUrl: string;
  collapsed: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onReload: () => Promise<void>;
  portrait: string;
  pressPerson: string;
  pressRole: string;
};

export function InsightBlockCard({
  block,
  index,
  insightId,
  uploadRoot,
  siteUrl,
  collapsed,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMove,
  onReload,
  portrait,
  pressPerson,
  pressRole
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [body, setBody] = useState<Loc>(asLoc(block.body));
  const [question, setQuestion] = useState<Loc>(asLoc(block.question));
  const [answer, setAnswer] = useState<Loc>(asLoc(block.answer));
  const [videoUrl, setVideoUrl] = useState(block.video_url ?? "");
  const [embedUrl, setEmbedUrl] = useState(block.embed_url ?? "");
  const [person, setPerson] = useState(pressPerson);
  const [role, setRole] = useState(pressRole);
  const [localPortrait, setLocalPortrait] = useState(portrait);
  const pendingRef = useRef<Record<string, unknown>>({});
  const personPendingRef = useRef<Record<string, unknown>>({});
  const imagePendingRef = useRef<Map<string, Record<string, unknown>>>(new Map());

  useEffect(() => {
    setBody(asLoc(block.body));
    setQuestion(asLoc(block.question));
    setAnswer(asLoc(block.answer));
    setVideoUrl(block.video_url ?? "");
    setEmbedUrl(block.embed_url ?? "");
    setPerson(pressPerson);
    setRole(pressRole);
    setLocalPortrait(portrait);
    pendingRef.current = {};
    personPendingRef.current = {};
    imagePendingRef.current = new Map();
  }, [block, pressPerson, pressRole, portrait]);

  function markDirty() {
    setSave((cur) => (cur === "saving" ? cur : "dirty"));
  }

  function queueChange(patch: Record<string, unknown>) {
    pendingRef.current = { ...pendingRef.current, ...patch };
    markDirty();
  }

  function queuePerson(patch: Record<string, unknown>) {
    personPendingRef.current = { ...personPendingRef.current, ...patch };
    markDirty();
  }

  function queueImage(imageId: string, patch: Record<string, unknown>) {
    const prev = imagePendingRef.current.get(imageId) ?? {};
    imagePendingRef.current.set(imageId, { ...prev, ...patch });
    markDirty();
  }

  function buildFullPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (block.preset === "text") {
      patch.body = body;
    }
    if (block.preset === "qa") {
      patch.question = question;
      patch.answer = answer;
    }
    if (block.preset === "video-full") {
      const trimmed = videoUrl.trim();
      if (!trimmed) {
        patch.video_kind = "hosted";
        patch.video_url = "";
      } else if (/^https?:\/\//i.test(trimmed)) {
        patch.video_kind = "embed";
        patch.video_url = trimmed;
      } else {
        patch.video_kind = block.video_kind || "hosted";
        patch.video_url = trimmed;
      }
    }
    if (block.preset === "embed") {
      patch.embed_provider = block.embed_provider || "youtube";
      patch.embed_url = embedUrl;
    }
    return patch;
  }

  async function savePartial() {
    setError(null);
    setSave("saving");
    const blockPatch = { ...buildFullPatch(), ...pendingRef.current };
    pendingRef.current = {};
    const personPatch = { ...personPendingRef.current };
    personPendingRef.current = {};
    const imageEntries = [...imagePendingRef.current.entries()];
    imagePendingRef.current = new Map();

    try {
      if (Object.keys(blockPatch).length > 0) {
        const res = await updateInsightBlock(insightId, block.id, blockPatch);
        if (!res.ok) {
          setSave("error");
          setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
          return;
        }
      }

      if (Object.keys(personPatch).length > 0) {
        const res = await updateInsight(insightId, personPatch);
        if (!res.ok) {
          setSave("error");
          setError(res.error + (res.details ? ` · ${JSON.stringify(res.details)}` : ""));
          return;
        }
      }

      for (const [imageId, patch] of imageEntries) {
        const res = await updateInsightImage(block.id, imageId, patch);
        if (!res.ok) {
          setSave("error");
          setError(res.error);
          return;
        }
      }

      setSave("saved");
      window.setTimeout(() => setSave((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      await onReload();
    } catch (err) {
      setSave("error");
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
    }
  }

  async function onClone() {
    const res = await createInsightBlock(insightId, {
      section_id: block.section_id,
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
  const fam = familyClass(block.preset);
  const isRich = block.preset === "text";

  return (
    <div
      id={`insight-block-${block.id}`}
      className={`${collapsed ? "blk" : "blk on"} ${fam}`}
    >
      <div
        className="bh"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span className="gr">⠿</span>
        <span className="kd">{orderLabel(index, name)}</span>
        {isRich ? <span className="c2">에디터</span> : null}
        <div className="ct" onClick={(event) => event.stopPropagation()}>
          <PartialSaveBtn
            state={save === "error" ? "dirty" : save}
            onClick={() => void savePartial()}
          />
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
          <button type="button" className="ico" onClick={() => void onClone()}>
            ⧉
          </button>
          <button type="button" className="ico" onClick={() => setDeleteOpen(true)}>
            ✕
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div className="bb space-y-3">
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}

          {isRich ? (
            <Field
              label="본문"
              counts={[
                { label: "국문", value: insightCharCount(body.ko) },
                { label: "영문", value: insightCharCount(body.en) }
              ]}
            >
              <div className="two">
                <div>
                  <span className="tag">국문</span>
                  <InsightBodyDrop html={body.ko} onOpen={() => setBodyOpen(true)} />
                </div>
                <div>
                  <span className="tag">영문</span>
                  <InsightBodyDrop html={body.en} onOpen={() => setBodyOpen(true)} />
                </div>
              </div>
            </Field>
          ) : null}

          {block.preset === "qa" ? (
            <>
              <Field label="인물 사진">
                <ImageUploader
                  bucket="insights"
                  folder={`${uploadRoot}/portrait`}
                  accept="image"
                  contentType="insight"
                  contentId={insightId}
                  multiple={false}
                  kind="body"
                  appearance="filecard"
                  siteUrl={siteUrl}
                  value={localPortrait || null}
                  emptyHint="올리기"
                  onUploaded={(files) => {
                    const first = files[0];
                    if (!first) return;
                    setLocalPortrait(first.src);
                    queuePerson({ portrait: first.src });
                  }}
                  onClear={() => {
                    setLocalPortrait("");
                    queuePerson({ portrait: null });
                  }}
                />
              </Field>
              <div className="two">
                <Field label="이름">
                  <TextInput
                    value={person}
                    onChange={(v) => {
                      setPerson(v);
                      queuePerson({ press_person: v.trim() || null });
                    }}
                  />
                </Field>
                <Field label="직함">
                  <TextInput
                    value={role}
                    onChange={(v) => {
                      setRole(v);
                      queuePerson({ press_role: v.trim() || null });
                    }}
                  />
                </Field>
              </div>
              <Field
                label="질문"
                required
                counts={[
                  { label: "국문", value: question.ko.length },
                  { label: "영문", value: question.en.length }
                ]}
              >
                <div className="two">
                  <div>
                    <span className="tag">국문</span>
                    <TextInput
                      value={question.ko}
                      onChange={(v) => {
                        const next = locField(question, "ko", v);
                        setQuestion(next);
                        queueChange({ question: next, answer });
                      }}
                    />
                  </div>
                  <div>
                    <span className="tag">영문</span>
                    <TextInput
                      value={question.en}
                      onChange={(v) => {
                        const next = locField(question, "en", v);
                        setQuestion(next);
                        queueChange({ question: next, answer });
                      }}
                    />
                  </div>
                </div>
              </Field>
              <Field
                label="답변"
                required
                counts={[
                  { label: "국문", value: answer.ko.length },
                  { label: "영문", value: answer.en.length }
                ]}
              >
                <div className="two">
                  <div>
                    <span className="tag">국문</span>
                    <textarea
                      className="i"
                      value={answer.ko}
                      onChange={(e) => {
                        const next = locField(answer, "ko", e.target.value);
                        setAnswer(next);
                        queueChange({ question, answer: next });
                      }}
                    />
                  </div>
                  <div>
                    <span className="tag">영문</span>
                    <textarea
                      className="i"
                      value={answer.en}
                      onChange={(e) => {
                        const next = locField(answer, "en", e.target.value);
                        setAnswer(next);
                        queueChange({ question, answer: next });
                      }}
                    />
                  </div>
                </div>
              </Field>
              <p className="hint-line">인터뷰에서 씁니다</p>
            </>
          ) : null}

          {limit !== 0 ? (
            <InsightImages
              images={images}
              blockId={block.id}
              insightId={insightId}
              siteUrl={siteUrl}
              uploadRoot={uploadRoot}
              atLimit={atLimit}
              onReload={onReload}
              onError={setError}
              onQueueImage={queueImage}
            />
          ) : null}

          {block.preset === "video-full" ? (
            <div className="space-y-3">
              <Field label="영상 파일" tip="MP4. Storage 로 직접 올립니다.">
                <ImageUploader
                  bucket="insights"
                  folder={`${uploadRoot}/video`}
                  accept="video"
                  contentType="insight"
                  contentId={insightId}
                  multiple={false}
                  siteUrl={siteUrl}
                  value={
                    videoUrl && !/^https?:\/\//i.test(videoUrl)
                      ? videoUrl
                      : videoUrl && /\.mp4(?:$|\?)/i.test(videoUrl)
                        ? videoUrl
                        : null
                  }
                  onUploaded={(files) => {
                    const first = files[0];
                    if (!first) return;
                    setVideoUrl(first.src);
                    queueChange({ video_kind: "hosted", video_url: first.src });
                  }}
                  onClear={() => {
                    setVideoUrl("");
                    queueChange({ video_kind: "hosted", video_url: "" });
                  }}
                />
              </Field>
              <Field
                label="또는 영상 주소"
                tip="유튜브·비메오 주소를 붙여넣으면 임베드로 재생합니다."
              >
                <TextInput
                  value={/^https?:\/\//i.test(videoUrl) ? videoUrl : ""}
                  onChange={(v) => {
                    setVideoUrl(v);
                    queueChange({ video_url: v });
                  }}
                />
              </Field>
            </div>
          ) : null}

          {block.preset === "embed" ? (
            <Field label="임베드 주소">
              <TextInput
                value={embedUrl}
                onChange={(v) => {
                  setEmbedUrl(v);
                  queueChange({
                    embed_provider: block.embed_provider || "youtube",
                    embed_url: v
                  });
                }}
              />
            </Field>
          ) : null}
        </div>
      )}

      <LeadHtmlModal
        open={bodyOpen}
        title="글"
        subtitle={orderLabel(index, name)}
        ko={body.ko}
        en={body.en}
        surface="insight-body"
        limits={null}
        sanitize={sanitizeInsightHtml}
        toEditorHtml={insightToEditorHtml}
        charCount={insightCharCount}
        hint="이미지는 넣을 수 없습니다. 이미지 블록에서 넣으세요"
        onCancel={() => setBodyOpen(false)}
        onSave={(next) => {
          setBody(next);
          queueChange({ body: next });
          setBodyOpen(false);
        }}
      />

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

function InsightBodyDrop({
  html,
  onOpen
}: {
  html: string;
  onOpen: () => void;
}) {
  const empty = insightIsEmpty(html);
  const count = insightCharCount(html);
  const asHtml = insightLooksLikeHtml(html);

  function onKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      className="lead-drop"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      {empty ? (
        <span className="lead-ph">클릭해 편집</span>
      ) : asHtml ? (
        <span
          className="lead-html lead-html--insight"
          dangerouslySetInnerHTML={{ __html: sanitizeInsightHtml(html) }}
        />
      ) : (
        <span className="lead-html lead-html--insight is-plain">{html}</span>
      )}
      {empty ? null : (
        <span className="lead-foot">
          <span>클릭해 편집</span>
          <span>{count}</span>
        </span>
      )}
    </div>
  );
}

function InsightImages({
  images,
  blockId,
  insightId,
  siteUrl,
  uploadRoot,
  atLimit,
  onReload,
  onError,
  onQueueImage
}: {
  images: NonNullable<InsightBlock["insight_images"]>;
  blockId: string;
  insightId: string;
  siteUrl: string;
  uploadRoot: string;
  atLimit: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
  onQueueImage: (imageId: string, patch: Record<string, unknown>) => void;
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
            onReload={onReload}
            onError={onError}
            onQueueImage={onQueueImage}
          />
        );
      })}
      {atLimit ? null : (
        <ImageUploader
          bucket="insights"
          folder={`${uploadRoot}/blocks`}
          accept="image"
          contentType="insight"
          contentId={insightId}
          kind="body"
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
  onReload,
  onError,
  onQueueImage
}: {
  src: string | null;
  name: string;
  image: NonNullable<InsightBlock["insight_images"]>[number];
  blockId: string;
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
  onQueueImage: (imageId: string, patch: Record<string, unknown>) => void;
}) {
  const [alt, setAlt] = useState<Loc>(asLoc(image.alt));
  const [caption, setCaption] = useState<Loc>(asLoc(image.caption));
  const [visible, setVisible] = useState(Boolean(image.caption_visible));

  useEffect(() => {
    setAlt(asLoc(image.alt));
    setCaption(asLoc(image.caption));
    setVisible(Boolean(image.caption_visible));
  }, [image]);

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
          {image.width && image.height ? (
            <span>
              {image.width} × {image.height}
            </span>
          ) : null}
          <button
            type="button"
            className="ml-auto text-rose-600"
            onClick={() =>
              void deleteInsightImage(blockId, image.id).then((res) =>
                res.ok ? onReload() : onError(res.error)
              )
            }
          >
            삭제
          </button>
        </div>
        <Field
          label="대체 텍스트"
          counts={[
            { label: "국문", value: alt.ko.length },
            { label: "영문", value: alt.en.length }
          ]}
        >
          <div className="two">
            <div>
              <span className="tag">국문</span>
              <TextInput
                value={alt.ko}
                onChange={(v) => {
                  const next = locField(alt, "ko", v);
                  setAlt(next);
                  onQueueImage(image.id, { alt: next });
                }}
              />
            </div>
            <div>
              <span className="tag">영문</span>
              <TextInput
                value={alt.en}
                onChange={(v) => {
                  const next = locField(alt, "en", v);
                  setAlt(next);
                  onQueueImage(image.id, { alt: next });
                }}
              />
            </div>
          </div>
        </Field>
        <Field
          label="캡션"
          counts={[
            { label: "국문", value: caption.ko.length },
            { label: "영문", value: caption.en.length }
          ]}
        >
          <div className="two">
            <div>
              <span className="tag">국문</span>
              <TextInput
                value={caption.ko}
                onChange={(v) => {
                  const next = locField(caption, "ko", v);
                  setCaption(next);
                  onQueueImage(image.id, { caption: next });
                }}
              />
            </div>
            <div>
              <span className="tag">영문</span>
              <TextInput
                value={caption.en}
                onChange={(v) => {
                  const next = locField(caption, "en", v);
                  setCaption(next);
                  onQueueImage(image.id, { caption: next });
                }}
              />
            </div>
          </div>
        </Field>
        <ToggleRow
          on={visible}
          title="화면에 캡션 표시"
          onToggle={() => {
            const next = !visible;
            setVisible(next);
            void updateInsightImage(blockId, image.id, { caption_visible: next }).then((res) => {
              if (!res.ok) {
                setVisible(!next);
                onError(res.error);
                return;
              }
              void onReload();
            });
          }}
        />
      </div>
    </div>
  );
}
