-- 트렌드 레이더: GPT 큐레이터 프롬프트 설정

alter table public.trend_sources
  add column if not exists gpt_prompt text;

create table if not exists public.trend_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.trend_settings (key, value)
values (
  'gpt_curator_prompt',
  $prompt$너는 아폴론이머시브웍스의 트렌드 큐레이터야.
아폴론은 공간과 디지털을 결합한 몰입형 경험을 만드는 미디어 아키텍처 스튜디오야.
주요 작업: 리테일/전시/공공공간의 디지털 랜드마크화, 미디어파사드, 인터랙티브 설치, 브랜드 공간 경험 설계.
반드시 JSON 배열만 응답해. 다른 텍스트 없이.

아래 기사 중 아폴론이 참고할 만한 기사 인덱스를 JSON 배열로만 응답해.
포함할 것:
- 미디어 아키텍처, 미디어파사드, 프로젝션 매핑
- 인터랙티브 설치, 몰입형 경험 (immersive experience)
- 전시 공간, 뮤지엄 디자인, 팝업 공간
- 리테일 경험 디자인, 플래그십 스토어
- 공공공간 디지털 설치, 랜드마크
- AI/기술을 활용한 공간/경험 디자인
제외할 것:
- 패션, 뷰티, 식품, 자동차, 스포츠
- 단순 인테리어/건축 (디지털/기술 요소 없는 것)
- 회화, 조각 등 전통 미술 (공간 경험과 무관한 것)
응답 예시: [0, 2, 5, 8]
기사 없으면: []$prompt$
)
on conflict (key) do nothing;

alter table public.trend_settings enable row level security;

drop policy if exists "trend_settings_select_auth" on public.trend_settings;
create policy "trend_settings_select_auth"
  on public.trend_settings for select to authenticated using (true);

drop policy if exists "trend_settings_insert_super_admin" on public.trend_settings;
create policy "trend_settings_insert_super_admin"
  on public.trend_settings for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists "trend_settings_update_super_admin" on public.trend_settings;
create policy "trend_settings_update_super_admin"
  on public.trend_settings for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "trend_settings_delete_super_admin" on public.trend_settings;
create policy "trend_settings_delete_super_admin"
  on public.trend_settings for delete to authenticated
  using (public.is_super_admin());

grant select on public.trend_settings to authenticated;
grant insert, update, delete on public.trend_settings to authenticated;
grant all on public.trend_settings to service_role;

notify pgrst, 'reload schema';
