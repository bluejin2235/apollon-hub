-- L3-03 자료 찾기: 0건·실패 구분 (블루진 수동 적용)
-- talk.search 프롬프트에 0건/실패 시 단정 금지 규칙 추가

UPDATE public.luna_prompts
SET
  content = content || E'\n4. 검색 결과가 0건일 때 ''없다''고 단정하지 않는다.\n   ''내 검색으로는 찾지 못했다''고 말하고, 다른 검색어나 담당자 확인을 제안한다.\n   검색 도구가 실패한 경우는 ''확인하지 못했다''고 구분해 말한다.',
  version = version + 1,
  updated_at = now()
WHERE prompt_key = 'talk.search'
  AND is_active = true
  AND content NOT LIKE '%내 검색으로는 찾지 못했다%';
