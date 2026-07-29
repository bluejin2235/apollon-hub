-- 라벨 인쇄 작업 큐 (Apollon Hub → 로컬 Print Bridge → Brother PT-P750W)
-- Supabase SQL Editor에서 실행

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  printer_name text not null default 'Brother PT-P750W',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_print_jobs_status
  on public.print_jobs (status)
  where status = 'pending';

create index if not exists idx_print_jobs_created
  on public.print_jobs (created_at desc);

alter table public.print_jobs enable row level security;

drop policy if exists "print_jobs_select_auth" on public.print_jobs;
create policy "print_jobs_select_auth"
  on public.print_jobs for select to authenticated
  using (true);

drop policy if exists "print_jobs_insert_auth" on public.print_jobs;
create policy "print_jobs_insert_auth"
  on public.print_jobs for insert to authenticated
  with check (requested_by = (select auth.uid()));

drop policy if exists "print_jobs_update_auth" on public.print_jobs;
create policy "print_jobs_update_auth"
  on public.print_jobs for update to authenticated
  using (true)
  with check (true);

grant select, insert, update on public.print_jobs to authenticated;
grant all on public.print_jobs to service_role;

-- Realtime (이미 추가된 경우 무시)
do $$
begin
  alter publication supabase_realtime add table public.print_jobs;
exception
  when duplicate_object then
    null;
end $$;
