const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { prefetchInventory } = loadTs('lib/luna/inventory-prefetch.ts');
const { inferRuleClassification } = loadTs('lib/luna/search-scope.ts');
const { keepSourcesUsedInAnswer } = loadTs('lib/luna/search-filter.ts');
const { importantMaterialsAnswer } = loadTs('lib/luna/important-project-materials.ts');

test('body and media start while Notion is pending; materials wait only for Notion', async () => {
  let releaseEmbedding, releaseNotion;
  const embedding = new Promise(resolve => { releaseEmbedding = resolve; });
  const notion = new Promise(resolve => { releaseNotion = resolve; });
  const events = [];
  const reads = prefetchInventory({ enabled: true, embedding, notion,
    body: async value => { events.push(['body', value]); return 'body rows'; },
    media: async value => { events.push(['media', value]); return 'media rows'; },
    materials: async value => { events.push(['materials', value]); return 'important rows'; }
  });
  assert.deepEqual(events, []);
  releaseEmbedding('embedding');
  assert.deepEqual(await Promise.all([reads.body, reads.media]), ['body rows', 'media rows']);
  assert.deepEqual(events.map(e => e[0]), ['body', 'media']);
  releaseNotion('grounded notion');
  assert.equal(await reads.materials, 'important rows');
  assert.deepEqual(events[2], ['materials', 'grounded notion']);
  await reads.body; await reads.media; await reads.materials;
  assert.equal(events.length, 3, 'joining prefetched results must not repeat reads');
});

test('disabled inventory prefetch does not invoke any extra connector', () => {
  const unexpected = () => { throw Error('disabled read'); };
  assert.equal(prefetchInventory({ enabled: false, embedding: Promise.resolve(null), notion: Promise.resolve([]),
    body: unexpected, media: unexpected, materials: unexpected }), null);
});

test('explicit broad project request is find by rule; analysis is not forced into inventory', () => {
  assert.deepEqual(inferRuleClassification('샘플센터 전체 자료 찾아줘').types, ['find']);
  assert.deepEqual(inferRuleClassification('샘플센터 모든 문서 보여주세요').types, ['find']);
  assert.notEqual(inferRuleClassification('샘플센터 전체 자료를 비교 분석해줘')?.reason, '규칙: 프로젝트 전체 자료');
});

test('the known inventory answer excludes unrelated wiki and web before streaming metadata', () => {
  const material = { cards:[{type:'nas',title:'제안서.pptx',raw_path:'02 Project/2026/Sample/제안서.pptx'}],
    sources:[],rows:[],prompt:'verified',trace:{} };
  const answer = importantMaterialsAnswer('샘플센터 전체 자료 찾아줘',material);
  const visible = keepSourcesUsedInAnswer({ answer, notFound:false, notion:[],
    cards:[...material.cards,{type:'web',title:'다른 서비스 안내'}],
    wiki:[{title:'개발 가이드',section_title:'데이터 모델과 어드민 필드'}] });
  assert.equal(visible.wiki.length,0);
  assert.deepEqual(visible.cards.map(c => c.title),['제안서.pptx']);
});
