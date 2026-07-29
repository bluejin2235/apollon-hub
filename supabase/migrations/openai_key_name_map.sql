-- OpenAI Tracking ID → 표시용 키 이름 매핑 (CSV 업로드 시 api_key_id 변환)

create table if not exists public.openai_key_name_map (
  id uuid primary key default gen_random_uuid(),
  tracking_id text not null unique,
  key_name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

create index if not exists idx_openai_key_name_map_tracking on public.openai_key_name_map (tracking_id);

alter table public.openai_key_name_map enable row level security;

drop policy if exists "openai_key_name_map_select_auth" on public.openai_key_name_map;
create policy "openai_key_name_map_select_auth"
  on public.openai_key_name_map for select to authenticated using (true);

drop policy if exists "openai_key_name_map_insert_super_admin" on public.openai_key_name_map;
create policy "openai_key_name_map_insert_super_admin"
  on public.openai_key_name_map for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists "openai_key_name_map_update_super_admin" on public.openai_key_name_map;
create policy "openai_key_name_map_update_super_admin"
  on public.openai_key_name_map for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "openai_key_name_map_delete_super_admin" on public.openai_key_name_map;
create policy "openai_key_name_map_delete_super_admin"
  on public.openai_key_name_map for delete to authenticated
  using (public.is_super_admin());
