-- API 키 별칭 정규화 + api_usage upsert 충돌키에 workspace_name 포함
create table if not exists public.api_key_aliases (
  alias text primary key,
  canonical text not null,
  created_at timestamptz not null default now()
);

alter table public.api_key_aliases enable row level security;

drop policy if exists "api_key_aliases_select_auth" on public.api_key_aliases;
create policy "api_key_aliases_select_auth"
  on public.api_key_aliases for select to authenticated using (true);

drop policy if exists "api_key_aliases_write_auth" on public.api_key_aliases;
create policy "api_key_aliases_write_auth"
  on public.api_key_aliases for all to authenticated using (true) with check (true);

alter table public.api_usage add column if not exists workspace_name text;

alter table public.api_usage drop constraint if exists api_usage_unique_record;
alter table public.api_usage
  add constraint api_usage_unique_record
  unique nulls not distinct (provider, date, model, api_key_label, workspace_name);
