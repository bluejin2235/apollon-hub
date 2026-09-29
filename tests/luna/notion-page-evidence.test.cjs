const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const { composePageEvidence, readIndexedNotionEvidence } = loadTs('lib/luna/notion-page-evidence.ts');
test('page reading includes changed scope and schedule beyond a short matching hit', async () => {
  const source = {id:'a',title:'공원 계획',excerpt:'숲 프로젝션 검토',url:'https://notion.so/a'};
  const db = fakeDb({luna_notion_chunks:[
    {page_id:'a',position:0,text:'초기안: 숲 프로젝션 검토'},
    {page_id:'a',position:1,text:'변경안: 프로젝션 제외, 숲 라이팅만 진행'},
    {page_id:'a',position:2,text:'최신 일정: 12월 공원과 함께 오픈'},
    {page_id:'other',position:0,text:'다른 프로젝트 비공개 자료'}]});
  const [read] = await readIndexedNotionEvidence(db,[source],'야외 숲 자료 모두 찾아줘');
  assert.match(read.excerpt,/프로젝션 제외/);
  assert.match(read.excerpt,/12월/);
  assert.doesNotMatch(read.excerpt,/다른 프로젝트/);
  assert.equal(read.url,source.url);
});
test('long pages retain matching sections and adjacent constraints with a bounded excerpt', () => {
  const rows=Array.from({length:50},(_,position)=>({position,text:'서론 '.repeat(100)}));
  rows[35].text='숲 라이팅 연출 계획'; rows[36].text='변경 일정: 12월 오픈';
  const result=composePageEvidence(rows,'숲 자료 모두 찾아줘',1200);
  assert.match(result,/숲 라이팅/);assert.match(result,/12월 오픈/);assert.ok(result.length<=1200);
});
test('failed page reads preserve original evidence and page budgets are independent',async()=>{
 const sources=Array.from({length:40},(_,i)=>({id:String(i),title:'문서',excerpt:'원래 근거'}));
 const db=fakeDb({}, {luna_notion_chunks:{message:'unavailable'}});
 assert.deepEqual(await readIndexedNotionEvidence(db,sources,'자료 모두 찾아줘'),sources);
 assert.equal(db.calls.length,32);
});
