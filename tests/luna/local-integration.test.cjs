const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');

test('running local study records retain honest completed-result labels', () => {
  const { studyOutcomeLabel } = loadTs('lib/luna/study-status.ts');
  assert.equal(studyOutcomeLabel(null, { running: true }), '진행 중');
  assert.equal(studyOutcomeLabel('improved', { running: true }), '진행 중');
  assert.equal(studyOutcomeLabel('improved', { running: false }), '효과 미검증');
  assert.equal(studyOutcomeLabel('failed', { running: true }), '실행 실패');
});

test('source-stage summaries do not infer rank-one hits from non-misses', () => {
  const { formatModeAResultLine } = loadTs('lib/luna/study-report.ts');
  const line = formatModeAResultLine({ stages: [
    { source: 'work', probed: 20, miss: 3, hit_at_5: 17, llm_calls: 2 }
  ] });
  assert.match(line, /20건 · 못 찾음 3/);
  assert.match(line, /Work —\/20/);
  assert.doesNotMatch(line, /Work 17\/20/);
  assert.equal(formatModeAResultLine({ mode: 'failure_review', stages: [{ source: 'work' }] }), null);
});

test('merged morning report includes source-stage totals without claiming improvement', () => {
  const { buildStudyMorningReport } = loadTs('lib/luna/study-report.ts');
  const report = buildStudyMorningReport([{
    id: 'synthetic-run', agenda: 'sample', why: '', expected: '', kind: 'probe_retrieval',
    scope: { trigger: 'cron' }, outcome: 'improved', cost_usd: 0, llm_calls: 0,
    result: { stages: [{ source: 'work', probed: 10, miss: 2, hit_at_1: 6, llm_calls: 3 }] },
    started_at: '2026-09-27T00:00:00Z', finished_at: '2026-09-27T00:01:00Z'
  }]);
  assert.equal(report.cards[0].outcomeLabel, '효과 미검증');
  assert.match(report.cards[0].result, /Work 6\/10/);
  assert.equal(report.totalCalls, 3);
});

test('office and laptop path copies preserve drive and special filename characters', () => {
  const { nasExplorerFilePair, nasExplorerFolderPair } = loadTs('lib/luna/nas-path.ts');
  const pair = nasExplorerFilePair('P', 'Demo\\100%_sample', 'final.pptx');
  assert.equal(pair.office, 'P:\\Demo\\100%_sample\\final.pptx');
  assert.equal(pair.laptop, 'Z:\\Partners\\Demo\\100%_sample\\final.pptx');
  const folder = nasExplorerFolderPair('T', 'Demo\\final.pptx', true);
  assert.equal(folder.office, 'T:\\Demo');
  assert.equal(folder.laptop, 'Z:\\Work\\Demo');
});

test('a deliberately held job remains neutral while real failures retain priority', () => {
  const { worstLight, lightEmoji } = loadTs('lib/luna-admin/traffic.ts');
  const { parseJobHolds, formatHeldDetail } = loadTs('lib/luna/job-holds.ts');
  assert.equal(worstLight('gray'), 'gray');
  assert.equal(worstLight('gray', 'red'), 'red');
  assert.equal(lightEmoji('gray'), '⚪');
  const holds = parseJobHolds({ image_index: { by: 'human', reason: 'review', since: '2026-09-27' } });
  assert.match(formatHeldDetail(holds.image_index, 'yesterday'), /사람이 멈춤.*review/);
});

test('local human-failure grouping coexists with recorded-retrieval safeguards', () => {
  const { groupOpenFailureAskItems, collectAutoFailureSignals } = loadTs('lib/luna/failures-shared.ts');
  const rows = ['a', 'b'].map(id => ({ id, question: '출장비 규정', created_at: '2026-09-27', signal: 'not_found' }));
  assert.equal(groupOpenFailureAskItems(rows)[0].count, 2);
  assert.equal(collectAutoFailureSignals({ answer: 'answer' }).includes('zero_search'), false);
  assert.equal(collectAutoFailureSignals({ answer: 'answer', searchAttempted: true, searchResultCount: 0 }).includes('zero_search'), true);
});
