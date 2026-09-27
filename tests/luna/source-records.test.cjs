const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const { uniqueSourceRecords } = loadTs('lib/luna/source-records.ts');
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const url = 'https://app.notion.com/p/title-aaaaaaaabbbbccccddddeeeeeeeeeeee';
test('Notion cards and page records share identity across URL formats', () => {
  const result = uniqueSourceRecords([{ type: 'notion', url }], [{ id, url: 'https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee?v=other' }], []);
  assert.equal(result.count, 1);
  assert.equal(result.cards.length, 1);
  assert.equal(result.notion.length, 0);
});
test('different drives, wiki sections and unidentified equal titles are preserved', () => {
  const result = uniqueSourceRecords([
    { drive: 'T', raw_path: 'a\\b' }, { drive: 't', raw_path: 'a/b' },
    { drive: 'P', raw_path: 'a/b' }, { title: 'same' }, { title: 'same' }
  ], [], [{ slug: 'doc', section_id: 'one' }, { slug: 'doc', section_id: 'two' }, { slug: 'doc', section_id: 'one' }]);
  assert.equal(result.count, 6);
});
test('untrusted lookalike Notion hosts do not become page identities', () => {
  assert.equal(uniqueSourceRecords([{ type: 'notion', url: url.replace('app.notion.com', 'notion.com.example.org') }], [{ id }], []).count, 2);
  assert.equal(uniqueSourceRecords(null, [null, 'bad'], {}).count, 0);
});
test('detail API deduplicates before display limits and retains historical count', async () => {
  const cards = Array.from({ length: 25 }, (_, i) => ({ type: 'web', url: `https://example.org/${i}` }));
  cards.push({ type: 'notion', url });
  const db = fakeDb({ luna_conversations: [{ id }], luna_messages: [{ id: 'message', conversation_id: id, role: 'assistant', metadata: { cards, notion_sources: [{ id, url }], search_evidence: { displayed_source_count: 27 } } }] });
  const { GET } = loadTs('app/api/luna/talk/detail/route.ts', {
    'next/server': { NextResponse: { json: (body) => body } },
    '@/lib/luna-admin/auth': { requireLunaAdmin: async () => ({ admin: db }) }
  });
  const result = await GET({ nextUrl: new URL(`https://example.org/?conversation_id=${id}`) });
  const search = result.messages[0].search;
  assert.equal(search.displayed_source_count, 27);
  assert.equal(search.unique_source_count, 26);
  assert.equal(search.sources_truncated, true);
  assert.equal(search.cards.length, 20);
  assert.equal(search.notion.length, 0);
});
