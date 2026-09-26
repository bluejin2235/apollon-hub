const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { studyOutcomeLabel, studyQuestionAttempts, studyActivitySummary } = loadTs('lib/luna/study-status.ts');
const run = (id, result, kind = 'probe_retrieval') => ({ id, result, kind });

test('legacy improved outcomes do not claim measured quality improvement', () => {
  assert.equal(studyOutcomeLabel('improved', { miss: 337 }), '효과 미검증');
  assert.equal(studyOutcomeLabel('failed'), '실행 실패');
  assert.equal(studyOutcomeLabel('improved', { timed_out: true }), '확인 필요');
});

test('repeated multi-source questions never create a Notion coverage percentage or completion date', () => {
  const result = studyActivitySummary([run('one', { probed: 4000 }), run('two', { probed: 4000 })], 2877);
  assert.equal(result.pct, null);
  assert.match(result.value, /8,000회.*반복 포함/);
  assert.doesNotMatch(result.value, /완료|일 남음|\//);
  assert.match(result.detail, /고유 문서 검증률.*측정되지/);
});

test('document samples, review mode and unrelated jobs do not inflate question attempts', () => {
  assert.equal(studyQuestionAttempts([
    run('a', { pages_sampled: 50 }), run('b', { mode: 'failure_review', probed: 20 }),
    run('c', { probed: 90 }, 'refresh_stale'), run('d', { probed: 12 }), run('d', { probed: 12 }),
    run('e', { probed: '100' }), run('f', { probed: -1 })
  ]), 12);
});

test('a failed source count remains unknown rather than zero', () => {
  assert.match(studyActivitySummary([], null).detail, /노션 문서 미확인/);
  assert.match(studyActivitySummary([], 0).detail, /노션 문서 0개/);
});

test('morning reports use the same honest outcome labels as the administrator screen', () => {
  const { buildStudyMorningReport } = loadTs('lib/luna/study-report.ts');
  const report = buildStudyMorningReport([{
    ...run('report', { probed: 965, miss: 337 }), agenda: 'exam', why: '', expected: '',
    scope: { trigger: 'cron' }, outcome: 'improved', cost_usd: 0, llm_calls: 0,
    started_at: '2026-09-26T00:00:00Z', finished_at: '2026-09-26T01:00:00Z'
  }]);
  assert.equal(report.cards[0].outcomeLabel, '효과 미검증');
});
