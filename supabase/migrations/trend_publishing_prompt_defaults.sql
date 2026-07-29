-- Publishing 프롬프트 기본값 (기존 키는 건드리지 않음)

insert into public.trend_settings (key, value)
values (
  'chat_selection_prompt',
  $prompt$아폴론이머시브웍스 팀원들의 채팅방 대화를 분석해서 아폴론의 사업 방향(미디어 아키텍처, 인터랙티브 설치, 몰입형 경험, 브랜드 공간)과 관련된 핵심 아젠다와 키워드를 추출해줘. 위클리 후보로 마킹된 것을 우선으로 하고, 반복 언급된 주제를 중심으로 최대 15개 아젠다를 뽑아줘.$prompt$
)
on conflict (key) do nothing;

insert into public.trend_settings (key, value)
values (
  'editor_prompt',
  $prompt$너는 아폴론이머시브웍스의 AI 편집장이야. 아폴론은 미디어 아키텍처 전문 스튜디오로 We Make Beloved Digital Landmarks가 미션이야. 채팅방 아젠다와 수집사이트 아티클 전체 후보 중에서 아폴론이 실제로 참고하고 영감받을 만한 것 최대 15개를 선정해줘. 선정 기준: 아폴론 프로젝트와 직접 연관성, 새로운 기술/공간 경험 트렌드, 클라이언트 제안서 활용 가능성.$prompt$
)
on conflict (key) do nothing;
