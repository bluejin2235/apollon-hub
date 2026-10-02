-- No Notion document bodies are stored here. Server-only encrypted OAuth grants.
create table public.luna_notion_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notion_user_id text not null,
  workspace_id text not null,
  credentials text not null check (credentials like 'v1.%'),
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  revision uuid not null,
  refresh_id uuid,
  refresh_until timestamptz,
  unique (workspace_id, notion_user_id)
);
create table public.luna_notion_oauth_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null unique,
  binding_hash text not null,
  payload text not null check (payload like 'v1.%'),
  expires_at timestamptz not null
);
alter table public.luna_notion_connections enable row level security;
alter table public.luna_notion_oauth_attempts enable row level security;
-- Deliberately no browser policies or privileges: route handlers validate auth and owner.
revoke all on public.luna_notion_connections, public.luna_notion_oauth_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.luna_notion_connections, public.luna_notion_oauth_attempts to service_role;
