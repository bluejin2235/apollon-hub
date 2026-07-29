-- AI편집장: 수집 이미지 숨김 목록 (원본 images 보존)
alter table public.trend_editor_candidates
  add column if not exists hidden_images text[] default '{}'::text[];

comment on column public.trend_editor_candidates.hidden_images is
  'Collected images hidden from the editor grid; original images array is preserved.';
