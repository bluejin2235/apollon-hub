const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { analyzeAssistantMessage, formatRelativeWhen } = loadTs('lib/luna/talk-metrics.ts', {
  '@/lib/luna/trace-weekly': { getCurrentWeekBounds() { throw new Error('not used in this test'); } }
});

test('hidden source cards do not turn successful retrieval into zero-search', () => {
  assert.equal(analyzeAssistantMessage('찾겠습니다', {
    cards: [], search_rounds: 1, search_evidence: { retrieved_candidate_peak: 28, displayed_source_count: 0 }
  }).searchZero, 0);
});

test('legacy empty-card records and unrecorded retrieval are not proof of zero-search', () => {
  for (const meta of [{}, { cards: [] }, { cards: [], search_rounds: 2 },
    { cards: [], search_rounds: 1, search_evidence: { retrieved_candidate_peak: null } }]) {
    assert.equal(analyzeAssistantMessage('', meta).searchZero, 0);
  }
});

test('zero-search requires both an executed search and an explicit zero candidate count', () => {
  assert.equal(analyzeAssistantMessage('', {
    search_rounds: 1, search_evidence: { retrieved_candidate_peak: 0 }
  }).searchZero, 1);
  for (const rounds of [undefined, null, 0, -1, '1', NaN, Infinity]) {
    assert.equal(analyzeAssistantMessage('', {
      search_rounds: rounds, search_evidence: { retrieved_candidate_peak: 0 }
    }).searchZero, 0);
  }
});

test('feedback and requery signals remain independent of card display', () => {
  const signal = analyzeAssistantMessage('[[가정: 확인 필요]]', { feedback: 'bad', clarify: true, search_rounds: 2, cards: [] });
  assert.deepEqual(signal, { thumbsUp: 0, thumbsDown: 1, clarify: 1, searchZero: 0, requery: 1, assume: 1 });
});

test('Korean conversation time keeps a two-digit minute', () => {
  assert.match(formatRelativeWhen('2026-09-21T08:08:00Z'), /17:08$/);
});
