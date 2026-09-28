const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const { matchNotionChunksByKeyword } = loadTs('lib/luna/notion-keyword.ts', {
  '@/lib/luna/embedding': { EMBEDDING_SCORE_WEIGHT: 10 }
});
const tables = {
  luna_notion_pages: [{ page_id: 'proposal', title: '샘플센터 제안서', archived: false }],
  luna_notion_chunks: [
    { chunk_id: 'title-only', page_id: 'proposal', heading: '개요', text: '설계 방향', position: 0 },
    { chunk_id: 'body', page_id: 'design', heading: '디자인', text: '샘플센터 설계', position: 0 }
  ]
};
test('body lookup starts while titles are pending and title representatives join before scoring', async () => {
  const base = fakeDb(tables);
  let releaseTitles;
  const titleGate = new Promise(resolve => { releaseTitles = resolve; });
  const started = [];
  const db = { from(table) {
    const builder = base.from(table);
    const originalThen = builder.then.bind(builder);
    builder.then = (resolve, reject) => {
      started.push(table);
      return (table === 'luna_notion_pages' ? titleGate : Promise.resolve())
        .then(() => originalThen(value => value)).then(resolve, reject);
    };
    return builder;
  }};
  const pending = matchNotionChunksByKeyword(db, ['샘플센터'], { light: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(started.includes('luna_notion_pages'));
  assert.ok(started.includes('luna_notion_chunks'), 'body lookup must not wait for titles');
  releaseTitles();
  const hits = await pending;
  assert.deepEqual(hits.map(hit => hit.chunk_id), ['title-only', 'body']);
  assert.ok(hits[0].keyword_score > hits[1].keyword_score);
  assert.equal(base.calls.filter(c => c.filters.some(f => f[1] === 'in')).length, 1);
});
test('a failed title lookup retains body evidence; full title scan failure keeps its existing guard', async () => {
  const db = fakeDb(tables, { luna_notion_pages: { message: 'fixture title unavailable' } });
  const light = await matchNotionChunksByKeyword(db, ['샘플센터'], { light: true });
  assert.deepEqual(light.map(hit => hit.chunk_id), ['body']);
  const fullDb = fakeDb(tables, { luna_notion_pages: { message: 'fixture scan unavailable' } });
  assert.deepEqual(await matchNotionChunksByKeyword(fullDb, ['샘플센터']), []);
  assert.equal(fullDb.calls.filter(c => c.table === 'luna_notion_chunks').length, 0);
});
