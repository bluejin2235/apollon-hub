const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs, fakeDb} = require('./helpers.cjs');
const named = loadTs('lib/luna/named-entities.ts');
const entities = [{canonical:'테스트프로젝트',kind:'project',aliases:[],searchPhrases:[],parentCanonical:null}];
const {searchAll, prepareSearchTerms} = loadTs('lib/luna/workserver.ts', {
  '@/lib/luna/named-entities': {...named,loadNamedEntities:async()=>entities}
});

test('question prose cannot become mandatory NAS path terms across subjects', async () => {
  for (const [keyword, question] of [
    ['조명','숲길에 빛을 설치하려고 해. 조명 관련 설계 검토를 찾아줘'],
    ['음향','로비에서 소리를 재생하고 싶어. 음향 설계 검토를 찾아줘'],
    ['구조','천장에 매달 수 있을지 궁금해. 구조 설계 검토를 찾아줘']
  ]) {
    assert.deepEqual(prepareSearchTerms(keyword,question,[]),[keyword]);
    const db=fakeDb({nas_directory:[{drive:'T',path:`Project\\${keyword} 설계검토.pdf`,type:'file',importance:1}]});
    assert.equal((await searchAll(db,keyword,question)).length,1);
  }
});

test('context still preserves registered project, season and date constraints', async () => {
  const question='테스트프로젝트 시즌1 260204 조명 검토를 확인하고 싶어';
  const terms=prepareSearchTerms('조명',question,entities);
  for (const term of ['테스트프로젝트','시즌1','260204','조명']) assert.ok(terms.includes(term));
  const db=fakeDb({nas_directory:[
    {drive:'T',path:'테스트프로젝트\\시즌1\\260204 조명.pdf',type:'file',importance:1},
    {drive:'T',path:'테스트프로젝트\\시즌2\\260204 조명.pdf',type:'file',importance:9},
    {drive:'T',path:'다른프로젝트\\시즌1\\260204 조명.pdf',type:'file',importance:9}
  ]});
  const result=await searchAll(db,'조명',question);
  assert.equal(result.length,1);
  assert.match(result[0].path,/테스트프로젝트\\시즌1/);
});

test('unknown project cannot be discarded by longest-word fallback',async()=>{
  const db=fakeDb({nas_directory:[{drive:'T',path:'다른사업\\음향시스템.pdf',type:'file',importance:1}]});
  assert.deepEqual(await searchAll(db,'미등록사업 음향시스템','미등록사업 음향시스템 자료'),[]);
});
