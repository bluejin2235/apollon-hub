-- 지식후보 7건 재분류 (term 3 / knowledge 4)
-- 실행: 블루진 또는 에이전트 (사용자 확정 반영)

BEGIN;

-- ── 1. 테스트 병합으로 삭제된 후보 4건 복원 ─────────────────────
INSERT INTO public.luna_learnings (
  id, category, content, status, source, origin, evidence,
  scope_suggestion, thread, meta, review_reason, duplicate_of, merge_target,
  confidence, importance, use_count
)
VALUES
  (
    'a8bb7ca6-7633-404a-8c2d-3df238733a26',
    'term',
    '건축·인테리어·HW의 기본설계와 실시설계와 콘텐츠의 프리프로덕션이 아폴론의 마스터플랜 단계 안에서 이뤄진다.',
    'candidate', 'interview', 'direct', '이택진 구술 2026-08-13', 'org', '[]'::jsonb,
    jsonb_build_object(
      'kind', 'glossary',
      'capture_kind', 'term',
      'term_ko', '마스터플랜',
      'term_en', NULL,
      'definition', '컨셉 확정 후 건축·인테리어·HW의 기본설계와 실시설계, 콘텐츠 프리프로덕션이 이루어지는 아폴론 고유 단계',
      'categories', '["common"]'::jsonb,
      'synonyms', '[]'::jsonb,
      'reclassified_at', '2026-08-18',
      'reclassified_note', 'term — 단계 구성·범위'
    ),
    'duplicate', '0647ba4b-e2c7-4119-bf72-1305f79c8e01', '0647ba4b-e2c7-4119-bf72-1305f79c8e01',
    2, 3, 0
  ),
  (
    '0e23ed9f-cab0-4ec9-8190-020e5fe2181a',
    'term',
    'On-site 테스트는 프로덕션 중간 버전을 실제 현장에 올려 테스트하며 인사이트·고객 의견을 받아 다음 퀄리티로 디벨롭하는 것이다.',
    'candidate', 'interview', 'direct', '이택진 구술 2026-08-13', 'org', '[]'::jsonb,
    jsonb_build_object(
      'kind', 'glossary',
      'capture_kind', 'term',
      'term_ko', 'On-site 테스트',
      'term_en', 'On-site Test',
      'definition', '프로덕션 중간 버전을 실제 현장에 올려 테스트하며, 인사이트·고객 의견을 받아 다음 퀄리티로 디벨롭하는 것',
      'categories', '["common"]'::jsonb,
      'synonyms', '["온사이트 테스트"]'::jsonb,
      'reclassified_at', '2026-08-18',
      'reclassified_note', 'term — 용어 정의'
    ),
    'duplicate', '287a5ca5-0dff-409a-b9e1-7609a6942d2d', '287a5ca5-0dff-409a-b9e1-7609a6942d2d',
    2, 3, 0
  ),
  (
    'a9c07423-e86f-474a-915b-f3adcdbf1aee',
    'general',
    '경험형 테넌트(experience-driven tenancy) 표준 레퍼런스: 코엑스 별마당도서관, 더현대 사운드포레스트, 싱가포르 주얼 창이 공항',
    'candidate', 'interview', 'direct', '이택진 구술 2026-08-13', 'org', '[]'::jsonb,
    jsonb_build_object(
      'capture_kind', 'knowledge',
      'reclassified_at', '2026-08-18',
      'reclassified_note', 'knowledge — 레퍼런스 선택은 우리 안목'
    ),
    'duplicate', '1bffc1cc-4711-4895-81e5-33b54a5644d2', '1bffc1cc-4711-4895-81e5-33b54a5644d2',
    2, 3, 0
  ),
  (
    '87ae3b81-e2b1-4f41-844f-b4271ccda090',
    'general',
    '아폴론은 시행사·건축주와 직접 계약하는 편이 유리하며, 설계사와의 계약은 최종 고객사인 시행사와 직접 커뮤니케이션 못하고 설계사의 요구사항을 맞추어야 해서 어려움이 있다.',
    'candidate', 'interview', 'direct', '이택진 구술 2026-08-13', 'org', '[]'::jsonb,
    jsonb_build_object(
      'capture_kind', 'knowledge',
      'reclassified_at', '2026-08-18',
      'reclassified_note', 'knowledge — 판단'
    ),
    'duplicate', '92edd57b-4e91-41ed-afa6-811655d26b39', '92edd57b-4e91-41ed-afa6-811655d26b39',
    2, 3, 0
  )
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  content = EXCLUDED.content,
  status = 'candidate',
  meta = EXCLUDED.meta,
  review_reason = EXCLUDED.review_reason,
  duplicate_of = EXCLUDED.duplicate_of,
  merge_target = EXCLUDED.merge_target,
  resolved_at = NULL,
  resolved_by = NULL,
  snoozed_until = NULL;

-- ── 2. term 3건 ────────────────────────────────────────────────
UPDATE public.luna_learnings
SET
  category = 'term',
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'kind', 'glossary',
    'capture_kind', 'term',
    'term_ko', '이머시브 앵커테넌트',
    'term_en', 'Immersive Anchor Tenant',
    'definition', '공간을 대표·상징하고 고객 재방문을 유도하는 디지털 키테넌트. 아폴론의 핵심 상품이다.',
    'categories', '["common"]'::jsonb,
    'synonyms', '[]'::jsonb,
    'reclassified_at', '2026-08-18',
    'reclassified_note', 'term — 상품 정의'
  )
WHERE id = 'cba0881e-4b60-4c0c-8854-f7f420a38bde';

-- ── 3. knowledge 4건 (기존 3건 + 복원 2건) ─────────────────────
UPDATE public.luna_learnings
SET
  category = 'general',
  meta = (COALESCE(meta, '{}'::jsonb) - 'kind' - 'term_ko' - 'term_en' - 'definition')
    || jsonb_build_object(
      'capture_kind', 'knowledge',
      'reclassified_at', '2026-08-18'
    )
WHERE id IN (
  '6d22450f-af18-42cf-a6dc-c2436a5d2eaa',
  '0f4067e0-f544-4610-b7af-507c7cc4b1c1',
  'a9c07423-e86f-474a-915b-f3adcdbf1aee',
  '87ae3b81-e2b1-4f41-844f-b4271ccda090'
);

COMMIT;
