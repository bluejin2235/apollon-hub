const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { collectNasTextMorningLine } = loadTs('lib/luna/nas-text-runs.ts');
async function report(rows) {
  const q = { select() { return q; }, gte() { return q; }, lt() { return q; },
    in: async () => ({ data: rows, error: null }) };
  return collectNasTextMorningLine({ from: () => q }, '2026-09-25', '2026-09-26');
}
test('mixed completion never hides failed files and runs', async () => {
  const line = await report([{status:'done',ok:3,chunks_created:8},
    {status:'failed',ok:2,chunks_created:4,failed:7}]);
  assert.match(line,/본문 5건 추출/);
  assert.match(line,/청크 12개/);
  assert.match(line,/실패 7건/);
  assert.match(line,/실패한 실행 있음/);
});
test('interruption remains visible beside a done run without promising resume', async () => {
  const line = await report([{status:'done'},{status:'interrupted'}]);
  assert.match(line,/완료되지 않은 작업 있음/);
  assert.match(line,/중단된 실행 있음/);
  assert.doesNotMatch(line,/신규 없음|이어받음/);
});
test('legacy done rows containing failures do not claim no new work', async () => {
  const line = await report([{status:'done',failed:2}]);
  assert.match(line,/실패 2건/);
  assert.doesNotMatch(line,/신규 없음/);
});
test('clean completion and empty history retain accurate summaries', async () => {
  assert.equal(await report([]),null);
  assert.equal(await report([{status:'done'}]),'어젯밤 본문 추출 — 신규 없음');
  assert.match(await report([{status:'done',embeddings_created:9}]),/임베딩 9개/);
});
test('run failure with zero failed files remains visible', async () => {
  const line = await report([{status:'done',ok:1},{status:'failed',failed:0}]);
  assert.match(line,/실패한 실행 있음/);
  assert.doesNotMatch(line,/실패 0건/);
});
