const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const policy = loadTs('lib/luna/data-context.ts');
const { loadRuntimeLearnings } = loadTs('lib/luna/runtime-learnings.ts');

test('synthetic identity survives a normal-looking title; ordinary testing discussions remain production', () => {
  for (const row of [
    { data_context: 'synthetic', title: '실제 프로젝트처럼 보이는 제목' },
    { title: '[P9TEST:run] 개인화점검' }, { title: '[role-latency-check]' },
    { title: '[LUNA-EVAL:run] 검색 점검' }, { meta: { is_test: true } },
    { meta: { test_run_id: 'regression-1' } }, { data_context: 'unknown' }
  ]) assert.equal(policy.isProductionData(row), false);
  assert.equal(policy.isProductionData({ data_context: 'production', title: '고객 테스트 결과를 찾아줘' }), true);
  assert.equal(policy.isProductionData(null), false);
});

test('legacy contaminated memo is not injected; ordinary user preferences are preserved', () => {
  assert.equal(policy.safeProductionMemo('하는 일: 기획\nP9FIX동선=관람흐름검증패턴'), '');
  assert.equal(policy.safeProductionMemo('답할 때: 간단히. 테스트 자료를 자주 찾음.'), '답할 때: 간단히. 테스트 자료를 자주 찾음.');
});

test('runtime excludes test, candidate and later-reclassified source conversations', async () => {
  const make = (id, extra = {}) => ({ id, content: id, status: 'active', category: 'criterion', data_context: 'production', ...extra });
  const db = fakeDb({
    luna_learnings: [make('approved'), make('pending', { status: 'candidate' }),
      make('synthetic', { data_context: 'synthetic' }), make('meta-test', { meta: { is_test: true } }),
      make('from-test', { source_conversation_id: 'test-room' }),
      make('missing-source', { source_conversation_id: 'missing-room' }),
      make('from-staff', { source_conversation_id: 'staff-room' })],
    luna_conversations: [{ id: 'test-room', title: 'renamed', data_context: 'synthetic' },
      { id: 'staff-room', title: '프로젝트 자료', data_context: 'production' }]
  });
  const result = await loadRuntimeLearnings(db);
  assert.equal(result.error, null);
  assert.deepEqual(result.data.map(row => row.id), ['approved', 'from-staff']);
});

test('a failed provenance lookup fails closed instead of injecting unverified knowledge', async () => {
  const db = fakeDb({ luna_learnings: [{ id: 'a', status: 'active', category: 'criterion', data_context: 'production', source_conversation_id: 'c' }] },
    { luna_conversations: { message: 'unavailable' } });
  const result = await loadRuntimeLearnings(db);
  assert.equal(result.data, null);
  assert.equal(result.error.message, 'unavailable');
});

test('candidate capture stops before wiki/LLM work for synthetic or inaccessible conversations', async () => {
  const { createCandidate } = loadTs('lib/luna/candidates.ts', {
    '@/lib/luna/prompts': {}, '@/lib/luna/llm/client': {}
  });
  for (const context of ['synthetic', null]) {
    const db = fakeDb({ luna_conversations: context ? [{ id: 'c', data_context: context }] : [] });
    assert.equal(await createCandidate(db, { content: 'synthetic claim', source: 'chat', source_conversation_id: 'c' }), null);
    assert.equal(db.calls.some(call => call.mutation), false);
  }
});

test('personal memory rewrite sees only production dialogue and drops contaminated previous memo', async () => {
  let prompt = '';
  const { rewriteUserMemo } = loadTs('lib/luna/user-memory.ts', {
    '@/lib/luna/llm/client': { lunaLlmComplete: async (_db, opts) => { prompt = opts.user; return { text: '하는 일: 프로젝트 기획' }; } },
    '@/lib/luna/memo-glossary-normalize': {
      formalTermsForMemoPrompt: async () => '', loadGlossaryCanon: async () => [],
      normalizeMemoAgainstGlossary: text => ({ text, fixes: [], skippedFuzzy: [] }),
      promoteMemoShorthandsAsGlossaryCandidates: async () => 0
    }
  });
  const db = fakeDb({
    luna_user_memories: [{ user_id: 'u', memo: 'P9FIX동선=가짜기억', answer_length: 'normal', updated_at: '2026-01-01' }],
    luna_conversations: [
      { id: 's', user_id: 'u', title: '[P9TEST:1]', data_context: 'synthetic', updated_at: '2026-09-24' },
      { id: 'p', user_id: 'u', title: '업무 자료', data_context: 'production', updated_at: '2026-09-23' }
    ],
    luna_messages: [
      { conversation_id: 's', role: 'user', content: 'SYNTHETIC_SENTINEL', created_at: '2026-09-24' },
      { conversation_id: 'p', role: 'user', content: '프로젝트 기획 자료를 찾아줘', created_at: '2026-09-23' }
    ]
  });
  const result = await rewriteUserMemo(db, 'u', { force: true });
  assert.equal(result.ok, true);
  assert.match(prompt, /프로젝트 기획 자료/);
  assert.doesNotMatch(prompt, /SYNTHETIC_SENTINEL|가짜기억/);
  assert.ok(db.calls.some(call => call.table === 'luna_user_memories' && call.mutation));
});
