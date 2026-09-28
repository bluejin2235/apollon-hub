const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {selectQuestionEvidence, queryExcerpt} = loadTs('lib/luna/evidence-selection.ts');
const query = '정원을 활용한 자료 중 우리가 제작한 것과 외부 참고자료를 나눠줘';
const choose = (items, q=query, n=3) => selectQuestionEvidence(items,n,q,x=>x.text,x=>x.score,x=>x.keyword);
test('production evidence survives high-ranked references without increasing the prompt budget',()=>{
  const items = [
    {id:'reference',text:'정원 벤치마킹 자료',score:10,keyword:4},
    {id:'other',text:'정원 후속 제안: 제작·실행 및 연출 과제',score:9,keyword:4},
    {id:'third',text:'정원 공간 아이디어',score:8,keyword:4},
    {id:'production',text:'정원 작품은 Studio Example이 기획하고 연출했다.',score:2,keyword:2},
    {id:'unrelated',text:'바다 작품을 자사가 제작했다.',score:20,keyword:0}
  ];
  const result=choose(items);
  assert.equal(result.length,3);
  assert.equal(result[0].id,'production');
  assert.equal(result[1].id,'reference');
  assert.deepEqual(choose(items,'정원 자료 찾아줘').map(x=>x.id),['reference','other','unrelated']);
  assert.deepEqual(choose(items,query,0),[]);
});
test('long excerpts preserve production facts near the topic instead of the first incidental mention',()=>{
  const body='정원 참고 링크. '+ '관련 없는 서론 '.repeat(250) + 'Studio Example이 정원 작품을 기획·연출했다. 제작 역할은 공동 작업이었다.';
  const excerpt=queryExcerpt(body,['정원','제작','외부'],1200,query);
  assert.match(excerpt,/공동 작업/);
  assert.ok(excerpt.length<=1202);
});
test('contradictory production evidence is retained for reading, not classified as company work',()=>{
  const items=[{id:'uncertain',text:'정원은 우리가 제작한 것이 아니다. 제작 주체는 확인 중이다.',score:1,keyword:2}];
  assert.deepEqual(choose(items),items);
});
