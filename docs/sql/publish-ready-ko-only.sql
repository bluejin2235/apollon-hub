-- works / insights 공개 준비 제약: 국문만 필수
-- 실행은 직접 하세요. 앱이 이 파일을 돌리지 않습니다.
--
-- 이전: summary · key_image_alt 국문·영문 둘 다
-- 이후: 국문(ko)만 있으면면 공개 가능. 영문은 나중에.

-- ── works ──────────────────────────────────────────────
alter table public.works
  drop constraint if exists works_publish_ready;

alter table public.works
  add constraint works_publish_ready
  check (
    status = 'draft'
    or (
      published_at is not null
      and nullif(btrim(coalesce(summary ->> 'ko', '')), '') is not null
      and nullif(btrim(coalesce(key_image_alt ->> 'ko', '')), '') is not null
    )
  );

comment on constraint works_publish_ready on public.works is
  '공개(status≠draft) 시 published_at · summary.ko · key_image_alt.ko 필수. 영문은 선택.';

-- ── insights (같은 이름 제약이 있을 때만) ─────────────
alter table public.insights
  drop constraint if exists insights_publish_ready;

alter table public.insights
  add constraint insights_publish_ready
  check (
    status = 'draft'
    or (
      published_at is not null
      and nullif(btrim(coalesce(summary ->> 'ko', '')), '') is not null
      and nullif(btrim(coalesce(key_image_alt ->> 'ko', '')), '') is not null
    )
  );

comment on constraint insights_publish_ready on public.insights is
  '공개(status≠draft) 시 published_at · summary.ko · key_image_alt.ko 필수. 영문은 선택.';
