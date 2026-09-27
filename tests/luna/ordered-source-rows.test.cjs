const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const { fetchOrderedSourceRows } = loadTs('lib/luna-admin/ordered-source-rows.ts');

test('page boundaries preserve every source exactly once despite unsorted storage', async () => {
  const rows = Array.from({ length: 1003 }, (_, i) => ({ id: String(i).padStart(5, '0'), title: 'same title' })).reverse();
  const db = fakeDb({ luna_library: rows });
  const result = await fetchOrderedSourceRows(db, 'luna_library', 'title');
  assert.equal(result.length, 1003);
  assert.equal(new Set(result.map(row => row.id)).size, 1003);
  assert.equal(result[0].id, '00000');
  assert.equal(result.at(-1).id, '01002');
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].columns, /\bid\b/);
});

test('relation pagination uses all three identity fields', async () => {
  const rows = [
    { from_page_id: 'a', to_page_id: 'b', property_name: 'z' },
    { from_page_id: 'a', to_page_id: 'c', property_name: 'a' },
    { from_page_id: 'a', to_page_id: 'b', property_name: 'a' }
  ];
  const result = await fetchOrderedSourceRows(fakeDb({ luna_notion_relations: rows }), 'luna_notion_relations', 'from_page_id', 2);
  assert.deepEqual(result.map(row => [row.to_page_id, row.property_name]), [['b', 'a'], ['b', 'z'], ['c', 'a']]);
});

test('missing identities and repeated pages fail instead of returning inflated evidence', async () => {
  await assert.rejects(fetchOrderedSourceRows(fakeDb({ luna_library: [{ title: 'missing id' }] }), 'luna_library', 'title'), /invalid source identity/);
  await assert.rejects(fetchOrderedSourceRows(fakeDb({ luna_library: [{ id: 'a' }, { id: 'a' }] }), 'luna_library', 'id', 1), /repeated source identity/);
});

test('a failed or absent page cannot silently truncate the source corpus', async () => {
  await assert.rejects(fetchOrderedSourceRows(fakeDb({}, { luna_library: { message: 'timeout' } }), 'luna_library', 'title'), /timeout/);
  const db = { from() { return { select() { return this; }, order() { return this; }, range: async () => ({ data: null, error: null }) }; } };
  await assert.rejects(fetchOrderedSourceRows(db, 'luna_library', 'title'), /missing source page/);
});
