const test=require('node:test'), assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const page=(id)=>({id,title:id,url:'https://notion.so/'+id});
const relevant='관람 동선을 따라 설치한 조명과 사운드의 전기 도면 및 현장 테스트 기록입니다.';
let follows=[];
const {buildDocumentInventory}=loadTs('lib/luna/document-inventory.ts',{
 '@/lib/luna/notion-project-directory':{readDirectoryMaterials:async(_db,projects)=>{follows=projects.map(p=>p.key);return projects.flatMap(p=>p.pageIds.map(page));}}
});
const reviewer=async rows=>{const direct=rows.flatMap((s,i)=>s.excerpt.includes(relevant)?[i]:[]);return {direct,adjacent:[],unrelated:rows.flatMap((s,i)=>direct.includes(i)?[]:[i]),evidence:direct.map(index=>({index,quote:relevant,reason:'실제 공간 설치에 필요한 도면과 시험 기록이다'}))};};
test('reads late passages and follows relevant actual memberships, never unrelated seeds',async()=>{
 const docs=[page('seed'),page('wrong')];
 const db=fakeDb({luna_notion_chunks:[
  {page_id:'seed',position:0,text:'일반 소개 '.repeat(1500)},
  {page_id:'seed',position:90,text:relevant},
  {page_id:'wrong',position:0,text:'무관한 실내 영상'},
  {page_id:'late',position:0,text:relevant},
  {page_id:'noise',position:0,text:'프로젝트 구성원의 점심 메뉴'}]});
 const result=await buildDocumentInventory(db,{query:'야간 공간 자료',sources:docs,
  directory:[{key:'actual',pageIds:['seed','late','noise']},{key:'unrelated',pageIds:['wrong','private']}],review:reviewer});
 assert.deepEqual(follows,['actual']);
 assert.deepEqual(result.direct.map(s=>s.id),['seed','late']);
 assert.deepEqual(result.unverifiedIds,[]);
 assert.ok(result.reviewedIds.includes('noise'));
 assert.ok(result.inspected.every(s=>!Object.hasOwn(s,'evidence_passages')));
 assert.ok(result.direct.every(s=>s.excerpt.includes(relevant)));
});
test('a failed body review is visible as incomplete, never accepted without proof',async()=>{
 const db=fakeDb({luna_notion_chunks:[{page_id:'a',position:0,text:relevant}]});
 const result=await buildDocumentInventory(db,{query:'자료',sources:[page('a')],directory:[],review:async()=>null});
 assert.deepEqual(result.unverifiedIds,['a']); assert.deepEqual(result.direct,[]);
});
