"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { useFullSave } from "@/components/website/full-save-registry";
import { ConfirmDialog } from "@/components/website/confirm-dialog";
import { ImageUploader, type UploadedMedia } from "@/components/website/image-uploader";
import { AltSuggestStatusLine, confirmOverwriteAlt } from "@/components/website/alt-suggest-ui";
import { LeadHtmlModal } from "@/components/website/lead-html-modal";
import {
  requestAltSuggest,
  resolveImageUrlForAlt,
  type AltSuggestStatus
} from "@/lib/website/alt-suggest-client";
import { hasExistingAlt, isSameAltTarget, mergeAiAlt } from "@/lib/website/alt-suggest-apply";
import type { AltSuggestContext } from "@/lib/website/alt-suggest-types";
import {
  beginPendingAlt,
  clearPendingAlt,
  finishPendingAlt,
  getPendingAlt,
  setPendingAlt,
  subscribePendingAlt
} from "@/lib/website/alt-suggest-pending";
import {
  PartialSaveBtn,
  type PartialSaveState
} from "@/components/website/partial-save-btn";
import { AUTO_PARTIAL_SAVE_DEBOUNCE_MS } from "@/components/website/use-auto-partial-save";
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
import { apiFailMessage } from "@/lib/website/api-fail-message";
import {
  insightCharCount,
  insightIsEmpty,
  insightLooksLikeHtml,
  sanitizeInsightHtml
} from "@/lib/website/insight-html";
import type { InsightBlock } from "@/lib/website/insight-detail";
import { asLoc, columnsFromBody, fileName, mediaUrl, type Loc } from "@/lib/website/work-detail";
import { formatPixelSize, SmallImageMarks } from "@/components/website/small-image-confirm";

const PRESET_LABEL: Record<string, string> = {
  text: "글",
  qa: "질문 · 답변",
  full: "전폭 이미지",
  "full-center": "전폭 이미지 · 가운데",
  split: "2단 나란히",
  triple: "3단 나란히",
  quint: "5단 나란히",
  "gallery-auto": "자동 배치 갤러리",
  stack: "위아래 두 장",
  carousel: "가로 스크롤",
  "video-full": "영상 전폭",
  embed: "임베드",
  // 11-25 워크 모듈에서 가져온 9개 (이름은 워크와 같게)
  offset: "가로 + 세로",
  "offset-reverse": "세로 + 가로",
  compare: "전후 비교",
  "text-split": "2단 글",
  "text-triple": "3단 글",
  "image-text": "이미지 + 글 나란히",
  "text-image": "글 + 큰 이미지",
  "portrait-text": "세로 이미지 + 글",
  "video-text": "영상 + 글"
};

/** 글이 한 칸(서식 없는 글자)인 워크식 모듈. 글 위치를 고른다 */
const PLAIN_BODY_PRESETS = new Set(["image-text", "text-image", "portrait-text", "video-text"]);
/** 2단·3단 글 칸 수 */
const COLUMN_COUNT: Record<string, number> = { "text-split": 2, "text-triple": 3 };
/** 영상 파일·주소를 받는 모듈 */
const VIDEO_PRESETS = new Set(["video-full", "video-text"]);

/** 영상 주소의 종류. 파일(MP4 등·Storage)은 hosted, 유튜브·비메오는 embed, 모르면 지금 값 */
export function videoKindForUrl(url: string, current: string | null | undefined): string {
  const value = url.trim();
  if (/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(value) || /\/storage\/v1\/object\//i.test(value)) {
    return "hosted";
  }
  if (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//i.test(value)) {
    return "embed";
  }
  if (!/^https?:\/\//i.test(value)) return current || "hosted";
  return current || "embed";
}

/** 공개 화면(워크 ImageTextBlock·VideoBlock)과 같은 기본 글 위치 */
function defaultTextSide(preset: string): "left" | "right" {
  return preset === "text-image" ? "left" : "right";
}

/** 글 계열 → accent, 이미지 → pro, 영상·임베드 → success */
function familyClass(preset: string): "fam-accent" | "fam-pro" | "fam-success" {
  if (preset === "text" || preset === "qa" || preset in COLUMN_COUNT) return "fam-accent";
  if (VIDEO_PRESETS.has(preset) || preset === "embed") return "fam-success";
  return "fam-pro";
}

function insightImageLimit(preset: string): number | null {
  if (
    preset === "text" ||
    preset === "qa" ||
    VIDEO_PRESETS.has(preset) ||
    preset === "embed" ||
    preset in COLUMN_COUNT
  ) {
    return 0;
  }
  return imageLimitForPreset(preset);
}

function orderLabel(index: number, name: string) {
  return `${String(index).padStart(2, "0")} · ${name}`;
}

type SaveState = PartialSaveState;

const STALE_REMOTE_MSG = "다른 곳에서 바뀌었습니다. 저장하면 이 입력으로 덮어씁니다.";

function insightBlockServerRev(block: InsightBlock) {
  if (block.updated_at) return `${block.id}:${block.updated_at}`;
  return JSON.stringify({
    id: block.id,
    preset: block.preset,
    body: block.body,
    question: block.question,
    answer: block.answer,
    video_url: block.video_url,
    embed_url: block.embed_url
  });
}

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
  altContext?: AltSuggestContext | null;
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
  pressRole,
  altContext = null
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [body, setBody] = useState<Loc>(asLoc(block.body));
  const columnCount = COLUMN_COUNT[block.preset] ?? 0;
  const [columns, setColumns] = useState<Loc[]>(() =>
    columnsFromBody(block.body, columnCount || 2)
  );
  const [textSide, setTextSide] = useState<"left" | "right">(
    block.text_side ?? defaultTextSide(block.preset)
  );
  const [question, setQuestion] = useState<Loc>(asLoc(block.question));
  const [answer, setAnswer] = useState<Loc>(asLoc(block.answer));
  const [videoUrl, setVideoUrl] = useState(block.video_url ?? "");
  const [embedUrl, setEmbedUrl] = useState(block.embed_url ?? "");
  const [person, setPerson] = useState(pressPerson);
  const [role, setRole] = useState(pressRole);
  const [localPortrait, setLocalPortrait] = useState(portrait);
  const [staleRemote, setStaleRemote] = useState(false);
  const { registerFlush, registerDirty } = useFullSave();
  const pendingRef = useRef<Record<string, unknown>>({});
  const personPendingRef = useRef<Record<string, unknown>>({});
  const imagePendingRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const flushDirtyRef = useRef<() => Promise<boolean>>(async () => true);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const serverRev = insightBlockServerRev(block);

  useEffect(() => {
    const holding =
      saveRef.current === "dirty" ||
      saveRef.current === "saving" ||
      saveRef.current === "error" ||
      Object.keys(pendingRef.current).length > 0 ||
      Object.keys(personPendingRef.current).length > 0 ||
      imagePendingRef.current.size > 0;
    if (holding) {
      setStaleRemote(true);
      return;
    }
    setBody(asLoc(block.body));
    setColumns(columnsFromBody(block.body, COLUMN_COUNT[block.preset] || 2));
    setTextSide(block.text_side ?? defaultTextSide(block.preset));
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
    setStaleRemote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- block.id · serverRev 만
  }, [block.id, serverRev, pressPerson, pressRole, portrait]);

  useEffect(
    () => registerFlush(`insight-block:${block.id}`, () => flushDirtyRef.current()),
    [block.id, registerFlush]
  );

  useEffect(
    () =>
      registerDirty(`insight-block:${block.id}`, () => {
        const cur = saveRef.current;
        return cur === "dirty" || cur === "error" || cur === "saving";
      }),
    [block.id, registerDirty]
  );

  function markDirty() {
    setSave((cur) => (cur === "saving" ? cur : "dirty"));
  }

  function armDebounce() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushDirtyRef.current();
    }, AUTO_PARTIAL_SAVE_DEBOUNCE_MS);
  }

  function queueChange(patch: Record<string, unknown>) {
    pendingRef.current = { ...pendingRef.current, ...patch };
    markDirty();
    armDebounce();
  }

  function queuePerson(patch: Record<string, unknown>) {
    personPendingRef.current = { ...personPendingRef.current, ...patch };
    markDirty();
    armDebounce();
  }

  function queueImage(imageId: string, patch: Record<string, unknown>) {
    const prev = imagePendingRef.current.get(imageId) ?? {};
    imagePendingRef.current.set(imageId, { ...prev, ...patch });
    markDirty();
    armDebounce();
  }

  function buildFullPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (block.preset === "text" || PLAIN_BODY_PRESETS.has(block.preset)) {
      patch.body = body;
    }
    if (columnCount > 0) {
      patch.body = { columns };
    }
    if (PLAIN_BODY_PRESETS.has(block.preset)) {
      patch.text_side = textSide;
    }
    if (block.preset === "qa") {
      patch.question = question;
      patch.answer = answer;
    }
    if (VIDEO_PRESETS.has(block.preset)) {
      const trimmed = videoUrl.trim();
      if (!trimmed) {
        patch.video_kind = "hosted";
        patch.video_url = "";
      } else {
        // 올린 MP4(Storage 주소 포함)는 hosted, 유튜브·비메오 주소만 embed.
        // 전에는 https 주소면 모두 embed 로 바꿔, 글만 고쳐도 올린 영상이 재생 안 되게 저장됐다
        patch.video_kind = videoKindForUrl(trimmed, block.video_kind);
        patch.video_url = trimmed;
      }
    }
    if (block.preset === "embed") {
      patch.embed_provider = block.embed_provider || "youtube";
      patch.embed_url = embedUrl;
    }
    return patch;
  }

  function holdingLocal(): boolean {
    return (
      saveRef.current === "dirty" ||
      saveRef.current === "error" ||
      saveRef.current === "saving" ||
      Object.keys(pendingRef.current).length > 0 ||
      Object.keys(personPendingRef.current).length > 0 ||
      imagePendingRef.current.size > 0 ||
      inflightRef.current !== null
    );
  }

  async function persistCurrent(): Promise<boolean> {
    const running = inflightRef.current;
    if (running) {
      const ok = await running;
      if (!ok) return false;
      if (!holdingLocal()) return true;
    }
    if (timer.current) clearTimeout(timer.current);
    setError(null);
    setSave("saving");
    const blockPatch = { ...buildFullPatch(), ...pendingRef.current };
    pendingRef.current = {};
    const personPatch = { ...personPendingRef.current };
    personPendingRef.current = {};
    const imageEntries = [...imagePendingRef.current.entries()];
    imagePendingRef.current = new Map();
    const restore = () => {
      pendingRef.current = { ...blockPatch, ...pendingRef.current };
      personPendingRef.current = { ...personPatch, ...personPendingRef.current };
      for (const [imageId, patch] of imageEntries) {
        const prev = imagePendingRef.current.get(imageId) ?? {};
        imagePendingRef.current.set(imageId, { ...patch, ...prev });
      }
    };

    try {
      if (Object.keys(blockPatch).length > 0) {
        const res = await updateInsightBlock(insightId, block.id, blockPatch);
        if (!res.ok) {
          restore();
          setSave("error");
          setError(apiFailMessage(res));
          return false;
        }
      }

      if (Object.keys(personPatch).length > 0) {
        const res = await updateInsight(insightId, personPatch);
        if (!res.ok) {
          restore();
          setSave("error");
          setError(apiFailMessage(res));
          return false;
        }
      }

      for (const [imageId, patch] of imageEntries) {
        const res = await updateInsightImage(block.id, imageId, patch);
        if (!res.ok) {
          restore();
          setSave("error");
          setError(res.error);
          return false;
        }
      }

      setSave("saved");
      setStaleRemote(false);
      window.setTimeout(() => setSave((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      return true;
    } catch (err) {
      restore();
      setSave("error");
      setError(err instanceof Error ? err.message : "저장하지 못했습니다");
      return false;
    }
  }

  async function persistQueued(): Promise<boolean> {
    const job = persistCurrent();
    inflightRef.current = job;
    const ok = await job;
    if (inflightRef.current === job) inflightRef.current = null;
    if (!ok) return false;
    if (
      Object.keys(pendingRef.current).length > 0 ||
      Object.keys(personPendingRef.current).length > 0 ||
      imagePendingRef.current.size > 0
    ) {
      return persistQueued();
    }
    return true;
  }

  async function savePartial() {
    const ok = await persistQueued();
    if (ok) await onReload();
  }

  async function flushDirty(): Promise<boolean> {
    if (!holdingLocal()) return true;
    return persistQueued();
  }
  flushDirtyRef.current = flushDirty;

  async function onClone() {
    // 고친 내용이 아직 저장 전이거나 막 저장돼 block 이 옛값일 수 있다. 먼저 저장하고, 화면의 지금 값으로 복제한다
    const flushed = await flushDirtyRef.current();
    if (!flushed) return;
    const current = buildFullPatch();
    const res = await createInsightBlock(insightId, {
      section_id: block.section_id,
      preset: block.preset,
      sort: block.sort + 1,
      body: "body" in current ? current.body : block.body,
      question: "question" in current ? current.question : block.question,
      answer: "answer" in current ? current.answer : block.answer,
      video_kind: "video_kind" in current ? current.video_kind : block.video_kind,
      video_url: "video_url" in current ? current.video_url : block.video_url,
      poster: block.poster,
      embed_provider: block.embed_provider,
      embed_url: "embed_url" in current ? current.embed_url : block.embed_url,
      embed_note: block.embed_note,
      ...(PLAIN_BODY_PRESETS.has(block.preset) ? { text_side: textSide } : {})
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
        {staleRemote ? <span className="c2">다른 곳에서 바뀜</span> : null}
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
          {staleRemote ? <p className="text-xs text-amber-800">{STALE_REMOTE_MSG}</p> : null}

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
                    onBlur={() => void flushDirtyRef.current()}
                  />
                </Field>
                <Field label="직함">
                  <TextInput
                    value={role}
                    onChange={(v) => {
                      setRole(v);
                      queuePerson({ press_role: v.trim() || null });
                    }}
                    onBlur={() => void flushDirtyRef.current()}
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
                      onBlur={() => void flushDirtyRef.current()}
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
                      onBlur={() => void flushDirtyRef.current()}
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
                      onBlur={() => void flushDirtyRef.current()}
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
                      onBlur={() => void flushDirtyRef.current()}
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
              altContext={altContext}
              atLimit={atLimit}
              onReload={onReload}
              onError={setError}
              onQueueImage={queueImage}
            />
          ) : null}

          {VIDEO_PRESETS.has(block.preset) ? (
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

          {PLAIN_BODY_PRESETS.has(block.preset) ? (
            <>
              <Field
                label="본문"
                counts={[
                  { label: "국문", value: body.ko.length },
                  { label: "영문", value: body.en.length }
                ]}
              >
                <div className="two">
                  <div>
                    <span className="tag">국문</span>
                    <textarea
                      className="i"
                      value={body.ko}
                      onChange={(e) => {
                        const next = locField(body, "ko", e.target.value);
                        setBody(next);
                        queueChange({ body: next });
                      }}
                      onBlur={() => void flushDirtyRef.current()}
                    />
                  </div>
                  <div>
                    <span className="tag">영문</span>
                    <textarea
                      className="i"
                      value={body.en}
                      onChange={(e) => {
                        const next = locField(body, "en", e.target.value);
                        setBody(next);
                        queueChange({ body: next });
                      }}
                      onBlur={() => void flushDirtyRef.current()}
                    />
                  </div>
                </div>
              </Field>
              <p className="hint-line">
                워크와 같은 서식 없는 글입니다. 굵게·소제목이 필요하면 「글」 블록을 쓰세요
              </p>
              <Field label="글 위치">
                <div className="flex gap-2">
                  {(["left", "right"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className={textSide === side ? "btn sm acc" : "btn sm"}
                      aria-pressed={textSide === side}
                      onClick={() => {
                        setTextSide(side);
                        queueChange({ text_side: side });
                      }}
                    >
                      {side === "left" ? "글 왼쪽" : "글 오른쪽"}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : null}

          {columnCount > 0 ? (
            <Field label="본문">
              <div
                className={
                  columnCount === 3
                    ? "grid grid-cols-1 gap-3 lg:grid-cols-3"
                    : "grid grid-cols-1 gap-3 md:grid-cols-2"
                }
              >
                {columns.slice(0, columnCount).map((col, colIndex) => (
                  <div key={colIndex} className="space-y-2">
                    <span className="tag">{colIndex + 1}번째 칸</span>
                    {(["ko", "en"] as const).map((lang) => (
                      <textarea
                        key={lang}
                        className="i"
                        placeholder={lang === "ko" ? "국문" : "영문"}
                        value={col[lang]}
                        onChange={(e) => {
                          const next = columns.map((item, i) =>
                            i === colIndex ? locField(item, lang, e.target.value) : item
                          );
                          setColumns(next);
                          queueChange({ body: { columns: next.slice(0, columnCount) } });
                        }}
                        onBlur={() => void flushDirtyRef.current()}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <p className="hint-line">칸끼리 길이를 비슷하게 맞추면 화면에서 높이가 어긋나지 않습니다</p>
            </Field>
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
        hint="이미지는 넣을 수 없습니다. 이미지 블록에서 넣으세요"
        onCancel={() => setBodyOpen(false)}
        onSave={(next) => {
          // 모달 안은 자동저장 없음. 확인=반영 + 즉시 flush, 취소=미반영
          setBody(next);
          pendingRef.current = { ...pendingRef.current, body: next };
          markDirty();
          setBodyOpen(false);
          void persistCurrent();
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
  altContext,
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
  altContext?: AltSuggestContext | null;
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
    if (!altContext) return;
    for (const file of files) {
      const url = resolveImageUrlForAlt(siteUrl, file.src);
      if (!url) {
        setPendingAlt(file.src, { status: "failed" });
        continue;
      }
      // 방금 올린 칸은 빈 대체 텍스트로 시작 — 요청 시점 값을 적용 직전 비교에 씀
      beginPendingAlt(file.src, { ko: "", en: "" });
      void requestAltSuggest({
        imageUrl: url,
        context: { ...altContext, fileName: file.name }
      }).then((result) => {
        finishPendingAlt(file.src, result);
      });
    }
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
            siteUrl={siteUrl}
            altContext={altContext}
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
  siteUrl,
  altContext,
  onReload,
  onError,
  onQueueImage
}: {
  src: string | null;
  name: string;
  image: NonNullable<InsightBlock["insight_images"]>[number];
  blockId: string;
  siteUrl: string;
  altContext?: AltSuggestContext | null;
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
  onQueueImage: (imageId: string, patch: Record<string, unknown>) => void;
}) {
  const [alt, setAlt] = useState<Loc>(asLoc(image.alt));
  const [caption, setCaption] = useState<Loc>(asLoc(image.caption));
  const [visible, setVisible] = useState(Boolean(image.caption_visible));
  const [altAi, setAltAi] = useState<AltSuggestStatus>("idle");
  const altRef = useRef(alt);
  altRef.current = alt;
  const imageIdRef = useRef(image.id);
  imageIdRef.current = image.id;
  const imageSrcRef = useRef(image.src);
  imageSrcRef.current = image.src;
  const altSeqRef = useRef(0);
  useEffect(() => {
    return () => {
      altSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setAlt(asLoc(image.alt));
    setCaption(asLoc(image.caption));
    setVisible(Boolean(image.caption_visible));
  }, [image]);

  useEffect(() => {
    function applyPending() {
      const pending = getPendingAlt(image.src);
      if (!pending) return;
      if (pending.status === "loading") {
        setAltAi("loading");
        return;
      }
      if (pending.status === "failed") {
        setAltAi("failed");
        clearPendingAlt(image.src);
        return;
      }
      // 올릴 때 자동 채우기 — 빈칸·임시값인 언어만 채운다
      const next = mergeAiAlt({
        before: { ko: pending.koBefore, en: pending.enBefore },
        now: altRef.current,
        result: { ko: pending.ko, en: pending.en },
        force: false
      });
      if (!next) {
        setAltAi("kept");
        clearPendingAlt(image.src);
        return;
      }
      altRef.current = next;
      setAlt(next);
      onQueueImage(image.id, { alt: next });
      setAltAi("filled");
      clearPendingAlt(image.src);
    }
    applyPending();
    return subscribePendingAlt(applyPending);
  }, [image.src, image.id, onQueueImage]);

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
          <div className="sic-fn min-w-0 flex-1">
            <span className="truncate">{name}</span>
            {image.width && image.height ? (
              <span className="sic-dim">{formatPixelSize(image.width, image.height)}</span>
            ) : null}
            <SmallImageMarks width={image.width} height={image.height} src={image.src} />
          </div>
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
                  if (altAi !== "idle") setAltAi("idle");
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
                  if (altAi !== "idle") setAltAi("idle");
                  const next = locField(alt, "en", v);
                  setAlt(next);
                  onQueueImage(image.id, { alt: next });
                }}
              />
            </div>
          </div>
          <AltSuggestStatusLine
            status={altAi}
            canRewrite={Boolean(image.src?.trim()) && Boolean(altContext)}
            onRewrite={() => {
              void (async () => {
                if (!altContext) return;
                const before = { ...altRef.current };
                if (!confirmOverwriteAlt(hasExistingAlt(before))) return;
                const url = resolveImageUrlForAlt(siteUrl, image.src);
                if (!url) {
                  setAltAi("failed");
                  return;
                }
                // 새 요청이 시작되면 이전 요청 결과는 버린다
                const started = { contentId: image.id, src: image.src, seq: ++altSeqRef.current };
                setAltAi("loading");
                const result = await requestAltSuggest({
                  imageUrl: url,
                  context: { ...altContext, fileName: name }
                });
                const current = {
                  contentId: imageIdRef.current,
                  src: imageSrcRef.current,
                  seq: altSeqRef.current
                };
                if (!isSameAltTarget(started, current)) {
                  if (started.seq === current.seq) setAltAi("idle");
                  return;
                }
                if (!result) {
                  setAltAi("failed");
                  return;
                }
                const next = mergeAiAlt({ before, now: altRef.current, result, force: true });
                if (!next) {
                  setAltAi("kept");
                  return;
                }
                altRef.current = next;
                setAlt(next);
                onQueueImage(image.id, { alt: next });
                setAltAi("filled");
              })();
            }}
          />
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
