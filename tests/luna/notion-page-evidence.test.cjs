const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs, fakeDb } = require('./helpers.cjs');
const { composePageEvidence, readIndexedNotionEvidence } = loadTs('lib/luna/notion-page-evidence.ts');
test('full-body windows preserve emoji across both overlapping boundaries',async()=>{
 const body='가'.repeat(5599)+'🌳'+'나'.repeat(398)+'🌲'+'현장 설치 근거'.repeat(200);
 const db=fakeDb({luna_notion_chunks:[{page_id:'emoji',position:0,text:body}]});
 const [read]=await readIndexedNotionEvidence(db,[{id:'emoji',title:'현장'}],'현장',true);
 assert.ok(read.evidence_passages.every(text=>text.isWellFormed() && body.includes(text)));
 assert.ok(read.evidence_passages.some(text=>text.includes('🌳')));
 assert.ok(read.evidence_passages.some(text=>text.includes('🌲')));
});
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
 assert.equal(db.calls.length,40);
});
test('a relevant page beyond the former first-32 cutoff is read',async()=>{
 const sources=Array.from({length:48},(_,i)=>({id:String(i),title:'후보 문서',excerpt:'짧은 검색 구절'}));
 const db=fakeDb({luna_notion_chunks:[{page_id:'47',position:0,text:'수목 사이 조명 설치에 필요한 전기 배관 도면과 현장 시험 결과'}]});
 const read=await readIndexedNotionEvidence(db,sources,'숲 조성 자료 모두 찾아줘');
 assert.match(read[47].excerpt,/전기 배관 도면/);
 assert.equal(db.calls.length,48);
});
test('changed scope survives when repeated early keywords would fill the summary budget',()=>{
 const rows=Array.from({length:12},(_,position)=>({position,text:'숲 프로젝션 초기안 '.repeat(110)}));
 rows[10].text='9/16 변경: 프로젝션 제외. 숲 라이팅으로 변경.';
 const evidence=composePageEvidence(rows,'숲 프로젝션 자료',2400);
 assert.match(evidence,/9\/16 변경/);assert.match(evidence,/프로젝션 제외/);
});
