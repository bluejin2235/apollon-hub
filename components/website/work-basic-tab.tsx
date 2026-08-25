"use client";

import {
  addCredit,
  addFolder,
  addMetric,
  deleteCredit,
  deleteFolder,
  deleteMetric,
  reorderCredits,
  reorderMetrics,
  updateCredit,
  updateFolder,
  updateMetric
} from "@/lib/website/api";
import type { WebsiteCategory } from "@/lib/website/types";
import type {
  WorkBasicDraft,
  WorkCredit,
  WorkDetail,
  WorkFolder,
  WorkMetric
} from "@/lib/website/work-detail";
import { asLoc, fileName, mediaUrl } from "@/lib/website/work-detail";
import { RepeatList, type SaveResult } from "@/components/website/repeat-list";
import { TagPicker } from "@/components/website/tag-picker";
import {
  AiBadge,
  BilingualField,
  CharPair,
  FieldLabel,
  GroupTitle,
  Guide,
  Hint,
  locField,
  Req,
  Sep,
  TextInput,
  ThumbBox,
  ToggleRow
} from "@/components/website/work-editor-ui";

type Props = {
  draft: WorkBasicDraft;
  onChange: (patch: Partial<WorkBasicDraft>) => void;
  work: WorkDetail;
  categories: WebsiteCategory[];
  siteUrl: string;
  onReload: () => Promise<void>;
};

function toOrder<T extends { id: string }>(items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, i) => ({ id: item.id, sort: i }));
}

function failOf(error: string): SaveResult {
  return { ok: false, error };
}

export function WorkBasicTab({ draft, onChange, work, categories, siteUrl, onReload }: Props) {
  const credits = [...(work.work_credits ?? [])].sort((a, b) => a.sort - b.sort);
  const metrics = [...(work.work_metrics ?? [])].sort((a, b) => a.sort - b.sort);
  const folders = work.work_folders ?? [];
  const tags = [...(work.work_tags ?? [])].sort((a, b) => a.sort - b.sort);
  const summaryLong = draft.summary.ko.length > 80;

  return (
    <div className="space-y-8">
      <section>
        <GroupTitle>제목 · 주소</GroupTitle>
        <div className="mb-3">
          <FieldLabel
            extra={
              <CharPair
                ko={draft.title.ko.length}
                en={draft.title.en.length}
                koWarn={11}
                enWarn={23}
                koLimit={22}
                enLimit={46}
              />
            }
          >
            제목
            <Req />
          </FieldLabel>
          <BilingualField
            ko={draft.title.ko}
            en={draft.title.en}
            onKo={(v) => onChange({ title: locField(draft.title, "ko", v) })}
            onEn={(v) => onChange({ title: locField(draft.title, "en", v) })}
          />
          <Guide>
            <b className="font-semibold text-slate-600">국문 8~22자</b> · 영문 15~46자
            <Sep />
            쓰이는 곳 —{" "}
            <b className="font-semibold text-slate-600">
              상세 제목 · 목록 카드 · 구글 검색 제목 · 링크 공유 제목 · 관련 콘텐츠 카드 · 구조화 데이터
            </b>
            <br />
            검색 제목에는 「 | 아폴론이머시브웍스」가 자동으로 붙습니다. 목록 작은 카드에서{" "}
            <b className="font-semibold text-slate-600">국문 11자 · 영문 23자</b>가 한 줄입니다. 그보다 길면 두 줄이 되고,
            22자(영문 46자)를 넘으면 세 줄이 되어 카드가 흐트러집니다.
          </Guide>
        </div>

        <div className="mb-3">
          <FieldLabel
            extra={
              <CharPair
                ko={draft.subtitle.ko.length}
                en={draft.subtitle.en.length}
                koWarn={30}
                enWarn={60}
                koLimit={30}
                enLimit={60}
              />
            }
          >
            부제
          </FieldLabel>
          <BilingualField
            ko={draft.subtitle.ko}
            en={draft.subtitle.en}
            onKo={(v) => onChange({ subtitle: locField(draft.subtitle, "ko", v) })}
            onEn={(v) => onChange({ subtitle: locField(draft.subtitle, "en", v) })}
          />
          <Guide>
            <b className="font-semibold text-slate-600">국문 30자 이내</b> · 영문 60자 이내
            <Sep />
            상세 페이지 제목 아래 한 줄로 들어갑니다. 장소나 클라이언트를 적습니다. 예) 스타애비뉴, 롯데면세점
            명동본점
          </Guide>
        </div>

        <div>
          <FieldLabel>
            주소 (slug)
            <Req />
          </FieldLabel>
          <TextInput value={draft.slug} onChange={(v) => onChange({ slug: v })} />
          <Guide>
            apollonworks.com/works/
            <b className="font-semibold text-slate-600">{draft.slug || "…"}</b>
            <Sep />
            <b className="font-semibold text-slate-600">영문 소문자와 하이픈(-)만</b>. 한글·공백·특수문자는 쓰지
            않습니다. 공개 후에 바꾸면 기존 검색 순위와 외부 링크가 끊깁니다.
          </Guide>
        </div>
      </section>

      <section>
        <GroupTitle>분류</GroupTitle>
        <div className="mb-3">
          <FieldLabel>
            카테고리
            <Req />
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const on = draft.category_id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onChange({ category_id: c.id })}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {c.label?.ko || c.id}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-3">
          <FieldLabel>태그</FieldLabel>
          <TagPicker
            workId={work.id}
            selectedIds={tags.map((t) => t.tag_id)}
            onReload={onReload}
          />
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <div>
            <FieldLabel>
              표기 연도
              <Req />
            </FieldLabel>
            <TextInput value={draft.year} onChange={(v) => onChange({ year: v })} />
            <Hint>화면에 보이는 연도</Hint>
          </div>
          <div>
            <FieldLabel>
              공개일
              <Req />
            </FieldLabel>
            <input
              type="date"
              value={draft.published_at}
              onChange={(e) => onChange({ published_at: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
            <Hint>검색엔진 정렬 기준</Hint>
          </div>
        </div>
      </section>

      <section>
        <GroupTitle>대표 이미지 · 배경 영상</GroupTitle>
        <div className="mb-3">
          <FieldLabel>
            대표 이미지
            <Req />
          </FieldLabel>
          <ThumbBox
            label={fileName(draft.key_image) || "대표 이미지"}
            src={mediaUrl(siteUrl, draft.key_image)}
          />
          <div className="mt-2 max-w-md">
            <TextInput
              value={draft.key_image}
              onChange={(v) => onChange({ key_image: v })}
              placeholder="경로 또는 URL"
            />
          </div>
          <Guide>
            <b className="font-semibold text-slate-600">JPG</b> ·{" "}
            <b className="font-semibold text-slate-600">2560 × 1440</b> (16:9 고정) ·{" "}
            <b className="font-semibold text-slate-600">2MB 이하</b>
            <Sep />
            쓰이는 곳 —{" "}
            <b className="font-semibold text-slate-600">
              목록 카드 · 상세 첫 화면 · 관련 콘텐츠 썸네일 · 링크 공유 이미지(카톡·슬랙·링크드인) · 구조화 데이터
            </b>
            <br />
            화면 크기에 맞는 작은 판도, 공유용 1200×630도{" "}
            <b className="font-semibold text-slate-600">이 한 장에서 자동으로 만듭니다.</b> 따로 올릴 것이 없습니다.
            <br />
            사람 얼굴이나 로고는 <b className="font-semibold text-slate-600">가운데</b>에 두세요. 작은 카드에서
            가장자리가 잘릴 수 있습니다.
          </Guide>
        </div>

        <div className="mb-3">
          <FieldLabel>
            대체 텍스트
            <Req />
          </FieldLabel>
          <BilingualField
            ko={draft.key_image_alt.ko}
            en={draft.key_image_alt.en}
            onKo={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "ko", v) })}
            onEn={(v) => onChange({ key_image_alt: locField(draft.key_image_alt, "en", v) })}
          />
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <div>
            <FieldLabel>배경 영상 — 큰 화면용</FieldLabel>
            <ThumbBox label={fileName(draft.loop_video_lg) || "loop-lg.mp4"} />
            <div className="mt-2">
              <TextInput
                value={draft.loop_video_lg}
                onChange={(v) => onChange({ loop_video_lg: v })}
                placeholder="경로 또는 URL"
              />
            </div>
            <Guide>
              <b className="font-semibold text-slate-600">MP4 (H.264)</b> ·{" "}
              <b className="font-semibold text-slate-600">1280 × 720</b> ·{" "}
              <b className="font-semibold text-slate-600">1.5MB 이하</b>
              <br />
              4~6초 · <b className="font-semibold text-slate-600">24fps</b> · 소리 없음 · 비트레이트 2Mbps
              <Sep />
              목록 맨 위 큰 카드, 메인 히어로에 쓰입니다.
            </Guide>
          </div>
          <div>
            <FieldLabel>배경 영상 — 작은 화면용</FieldLabel>
            <ThumbBox label={fileName(draft.loop_video_sm) || "loop-sm.mp4"} />
            <div className="mt-2">
              <TextInput
                value={draft.loop_video_sm}
                onChange={(v) => onChange({ loop_video_sm: v })}
                placeholder="경로 또는 URL"
              />
            </div>
            <Guide>
              <b className="font-semibold text-slate-600">MP4 (H.264)</b> ·{" "}
              <b className="font-semibold text-slate-600">640 × 360</b> ·{" "}
              <b className="font-semibold text-slate-600">0.5MB 이하</b>
              <br />
              4~6초 · <b className="font-semibold text-slate-600">24fps</b> · 소리 없음 · 비트레이트 0.7Mbps
              <Sep />
              목록 작은 카드, 메인 작은 칸에 쓰입니다.
            </Guide>
          </div>
        </div>

        <Guide warn>
          <b className="font-semibold text-slate-600">왜 두 벌인가</b> — 목록 한 화면에 큰 것 1개와 작은 것 8개가 함께
          깔립니다. 큰 파일 하나로 돌려쓰면 13MB가 나가지만, 나눠 쓰면 5MB로 줄어듭니다.{" "}
          <b className="font-semibold text-slate-600">
            작은 화면용을 올리지 않으면 작은 카드는 영상 없이 대표 이미지만 보입니다.
          </b>
          <br />
          프리미어에서 같은 시퀀스를 해상도만 바꿔 두 번 내보내면 됩니다. 내보내기 설정 두 벌을 팀에 공유해 두세요.
        </Guide>

        <div className="mt-4">
          <FieldLabel>목록에서 크게 보이기</FieldLabel>
          <ToggleRow
            on={draft.is_featured}
            onToggle={() => onChange({ is_featured: !draft.is_featured })}
            title="이 프로젝트를 목록 맨 위에 크게 배치"
            sub="한 번에 한 개만 지정할 수 있습니다"
          />
        </div>
      </section>

      <section>
        <GroupTitle note="구조화 데이터로 자동 변환됩니다">프로젝트 정보</GroupTitle>
        <div className="mb-3">
          <FieldLabel>클라이언트</FieldLabel>
          <BilingualField
            ko={draft.client.ko}
            en={draft.client.en}
            onKo={(v) => onChange({ client: locField(draft.client, "ko", v) })}
            onEn={(v) => onChange({ client: locField(draft.client, "en", v) })}
          />
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <div>
            <FieldLabel>프로젝트 유형</FieldLabel>
            <BilingualField
              ko={draft.project_type.ko}
              en={draft.project_type.en}
              onKo={(v) => onChange({ project_type: locField(draft.project_type, "ko", v) })}
              onEn={(v) => onChange({ project_type: locField(draft.project_type, "en", v) })}
            />
          </div>
          <div>
            <FieldLabel>완공 연도</FieldLabel>
            <TextInput
              value={draft.completed_year}
              onChange={(v) => onChange({ completed_year: v })}
            />
          </div>
        </div>
        <div className="mb-3">
          <FieldLabel>위치</FieldLabel>
          <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <TextInput
              value={draft.location_country.ko}
              onChange={(v) => onChange({ location_country: locField(draft.location_country, "ko", v) })}
              placeholder="국가"
            />
            <TextInput
              value={draft.location_city.ko}
              onChange={(v) => onChange({ location_city: locField(draft.location_city, "ko", v) })}
              placeholder="도시"
            />
            <TextInput
              value={draft.location_address.ko}
              onChange={(v) => onChange({ location_address: locField(draft.location_address, "ko", v) })}
              placeholder="주소"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <div className="mb-1 flex items-center gap-1">
                <span className="rounded bg-apollon-50 px-1 py-0.5 text-[10px] font-bold text-apollon-700">
                  영문
                </span>
                <AiBadge />
              </div>
              <TextInput
                value={draft.location_country.en}
                onChange={(v) => onChange({ location_country: locField(draft.location_country, "en", v) })}
                ai
              />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <span className="rounded bg-apollon-50 px-1 py-0.5 text-[10px] font-bold text-apollon-700">
                  영문
                </span>
                <AiBadge />
              </div>
              <TextInput
                value={draft.location_city.en}
                onChange={(v) => onChange({ location_city: locField(draft.location_city, "en", v) })}
                ai
              />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1">
                <span className="rounded bg-apollon-50 px-1 py-0.5 text-[10px] font-bold text-apollon-700">
                  영문
                </span>
                <AiBadge />
              </div>
              <TextInput
                value={draft.location_address.en}
                onChange={(v) => onChange({ location_address: locField(draft.location_address, "en", v) })}
                ai
              />
            </div>
          </div>
          <Guide>
            국가 · 도시 · 주소 순서
            <Sep />
            구조화 데이터로 나가므로 <b className="font-semibold text-slate-600">실제 행정 주소</b>를 씁니다. 건물
            이름만 쓰지 마세요. 해외 프로젝트는 영문으로.
          </Guide>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
          <div>
            <FieldLabel>규모 · 면적</FieldLabel>
            <BilingualField
              ko={draft.scale.ko}
              en={draft.scale.en}
              onKo={(v) => onChange({ scale: locField(draft.scale, "ko", v) })}
              onEn={(v) => onChange({ scale: locField(draft.scale, "en", v) })}
            />
            <Guide>
              <b className="font-semibold text-slate-600">60자 이내</b>
              <Sep />
              면적은 ㎡, 길이는 m. 숫자에 <b className="font-semibold text-slate-600">쉼표</b>를 넣습니다. 예)
              대지면적 129,836㎡ · 연면적 525,289㎡
            </Guide>
          </div>
          <div>
            <FieldLabel>수상 내역</FieldLabel>
            <BilingualField
              ko={draft.awards.ko}
              en={draft.awards.en}
              onKo={(v) => onChange({ awards: locField(draft.awards, "ko", v) })}
              onEn={(v) => onChange({ awards: locField(draft.awards, "en", v) })}
            />
          </div>
        </div>
        <div>
          <FieldLabel>참여 크레딧</FieldLabel>
          <RepeatList
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
            renderFields={(item, onChange) => {
              const name = asLoc(item.name);
              return (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <TextInput
                    value={item.role}
                    placeholder="역할 (영문)"
                    onChange={(v) => onChange({ role: v })}
                  />
                  <TextInput
                    value={name.ko}
                    placeholder="이름 국문"
                    onChange={(v) => onChange({ name: locField(name, "ko", v) })}
                  />
                  <TextInput
                    value={name.en}
                    placeholder="이름 영문"
                    onChange={(v) => onChange({ name: locField(name, "en", v) })}
                  />
                </div>
              );
            }}
            guide={
              <Guide>
                역할은 <b className="font-semibold text-slate-600">영문 표기</b>, 회사·사람 이름은 있는 그대로
                <Sep />
                Developer · Project Management · Architect · Construction Management · Media Architecture Design ·
                Client · 협업 작가 등 <b className="font-semibold text-slate-600">역할별로 한 줄씩</b> 추가합니다.
                <br />한 줄에 몰아 쓰면 검색엔진이 전부 「저자 이름」으로 잘못 읽습니다.
              </Guide>
            }
          />
        </div>
      </section>

      <section>
        <GroupTitle>요약 · 성과</GroupTitle>
        <div className="mb-3">
          <FieldLabel
            extra={
              <CharPair
                ko={draft.summary.ko.length}
                en={draft.summary.en.length}
                koWarn={80}
                enWarn={155}
                koLimit={80}
                enLimit={155}
              />
            }
          >
            한 줄 요약
            <Req />
          </FieldLabel>
          <BilingualField
            ko={draft.summary.ko}
            en={draft.summary.en}
            onKo={(v) => onChange({ summary: locField(draft.summary, "ko", v) })}
            onEn={(v) => onChange({ summary: locField(draft.summary, "en", v) })}
            multiline
          />
          <Guide>
            <b className="font-semibold text-slate-600">국문 60~80자</b> · 영문 120~155자 ·{" "}
            <b className="font-semibold text-slate-600">1~2문장</b>
            <Sep />
            쓰이는 곳 —{" "}
            <b className="font-semibold text-slate-600">
              목록 카드 · 상세 페이지 · 구글 검색 결과 설명 · 링크 공유 미리보기 · AI 인용
            </b>
            <br />
            「무엇을 어떻게 바꿨는가」를 한 문장으로. 형용사보다{" "}
            <b className="font-semibold text-slate-600">동사와 숫자</b>가 인용됩니다. 사람이 검색할 말(면세점 ·
            미디어아트 같은)이 자연스럽게 들어가면 좋습니다.
            <br />
            좋은 예) 지나가는 통로였던 면세점 K-POP 존을 머무는 몰입형 미디어 공간으로 재구성했습니다.
          </Guide>
          {summaryLong ? (
            <Guide warn>
              ⚠ <b className="font-semibold text-slate-600">{draft.summary.ko.length}자입니다.</b> 구글 검색
              결과에서 뒤가 잘립니다.{" "}
              <button
                type="button"
                disabled
                className="ml-1 inline-flex items-center rounded-md border border-apollon-200 bg-apollon-50 px-2 py-0.5 text-xs font-semibold text-apollon-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ✦ 검색용으로 줄이기
              </button>
              <br />
              <span className="text-slate-400">
                — 80자를 넘거나 검색어가 하나도 없을 때만 이 줄이 나타납니다. 누르면 80자 이내 문장을 따로 만들어
                검색 결과에만 씁니다. 화면에는 원래 문장이 그대로 나옵니다.
              </span>
            </Guide>
          ) : null}
          {summaryLong || draft.search_description.ko || draft.search_description.en ? (
            <div className="mt-3">
              <FieldLabel>검색 설명</FieldLabel>
              <BilingualField
                ko={draft.search_description.ko}
                en={draft.search_description.en}
                onKo={(v) =>
                  onChange({ search_description: locField(draft.search_description, "ko", v) })
                }
                onEn={(v) =>
                  onChange({ search_description: locField(draft.search_description, "en", v) })
                }
                multiline
              />
            </div>
          ) : null}
        </div>
        <div>
          <FieldLabel>성과 수치</FieldLabel>
          <RepeatList
            items={metrics}
            addLabel="＋ 항목 추가"
            onAdd={async () => {
              const res = await addMetric(work.id, {
                value: { ko: "수치", en: "" },
                sort: metrics.length
              });
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            onUpdate={async (item: WorkMetric) => {
              const res = await updateMetric(work.id, item.id, { value: asLoc(item.value) });
              return res.ok ? { ok: true } : failOf(res.error);
            }}
            onDelete={async (item: WorkMetric) => {
              const res = await deleteMetric(work.id, item.id);
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            onReorder={async (from, to) => {
              const res = await reorderMetrics(work.id, toOrder(metrics, from, to));
              if (!res.ok) return failOf(res.error);
              await onReload();
            }}
            renderFields={(item, onChange) => {
              const value = asLoc(item.value);
              return (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <TextInput
                    value={value.ko}
                    placeholder="값 국문"
                    onChange={(v) => onChange({ value: locField(value, "ko", v) })}
                  />
                  <TextInput
                    value={value.en}
                    placeholder="값 영문"
                    onChange={(v) => onChange({ value: locField(value, "en", v) })}
                  />
                </div>
              );
            }}
            guide={
              <Guide>
                <b className="font-semibold text-slate-600">항목당 30자 이내</b> · 3~5개 권장
                <Sep />
                AI가 가장 많이 인용하는 부분입니다.{" "}
                <b className="font-semibold text-slate-600">반드시 숫자를 넣으세요.</b>
                <br />
                좋은 예) 일평균 방문객 16,000명 <span className="mx-1.5 text-slate-300">·</span> 누적 112만 명(2개월){" "}
                <span className="mx-1.5 text-slate-300">·</span> 언론 보도 24건
                <br />
                나쁜 예) 방문객이 크게 늘었습니다 — 숫자가 없으면 인용되지 않습니다
              </Guide>
            }
          />
        </div>
      </section>

      <section>
        <GroupTitle note="외부에 노출되지 않습니다">내부 연결</GroupTitle>
        <RepeatList
          items={folders}
          addLabel="＋ 폴더 추가"
          onAdd={async () => {
            const res = await addFolder(work.id, { kind: "extra", path: "T:\\" });
            if (!res.ok) return failOf(res.error);
            await onReload();
          }}
          onUpdate={async (item: WorkFolder) => {
            const res = await updateFolder(work.id, item.id, { kind: item.kind, path: item.path });
            return res.ok ? { ok: true } : failOf(res.error);
          }}
          onDelete={async (item: WorkFolder) => {
            const res = await deleteFolder(work.id, item.id);
            if (!res.ok) return failOf(res.error);
            await onReload();
          }}
          onReorder={async () => ({ ok: true })}
          renderFields={(item, onChange) => (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={item.kind}
                onChange={(e) =>
                  onChange({ kind: e.target.value as WorkFolder["kind"] }, { save: true })
                }
                className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="ko">국문</option>
                <option value="en">영문</option>
                <option value="extra">추가</option>
              </select>
              <div className="min-w-0 flex-1">
                <TextInput
                  value={item.path}
                  placeholder="경로"
                  onChange={(v) => onChange({ path: v })}
                />
              </div>
            </div>
          )}
          guide={<Hint>나중에 루나가 이 워크와 내부 자료를 같은 프로젝트로 인식합니다</Hint>}
        />
      </section>
    </div>
  );
}
