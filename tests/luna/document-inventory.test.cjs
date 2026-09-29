const test=require('node:test'), assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
const page=(id)=>({id,title:id,url:'https://notion.so/'+id});
const relevant='관람 동선을 따라 설치한 조명과 사운드의 전기 도면 및 현장 테스트 기록입니다.';
let follows=[];
const {buildDocumentInventory}=loadTs('lib/luna/document-inventory.ts',{
 '@/lib/luna/notion-project-directory':{requestedDirectoryProjects:()=>[],readDirectoryMaterials:async(_db,projects)=>{follows=projects.map(p=>p.key);return projects.flatMap(p=>p.pageIds.map(page));}}
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
test('follows an empty calendar to its meeting and stops at unrelated bodies',async()=>{
 const ids=['seed','calendar','meeting','noise','hidden'];
 const db=fakeDb({
  luna_notion_pages:ids.map(id=>({page_id:id,title:id,archived:false,index_health:{state:id==='calendar'?'empty':'ready'}})),
  luna_notion_chunks:[{page_id:'seed',position:0,text:relevant},{page_id:'meeting',position:0,text:relevant},{page_id:'noise',position:0,text:'주간 식당 메뉴'}, {page_id:'hidden',position:0,text:relevant}],
  luna_notion_relations:[['seed','calendar'],['calendar','meeting'],['meeting','seed'],['seed','noise'],['noise','hidden']].map(([from_page_id,to_page_id])=>({from_page_id,to_page_id,property_name:'연결'}))
 });
 const result=await buildDocumentInventory(db,{query:'설치 자료',sources:[page('seed')],directory:[],review:reviewer});
 assert.deepEqual(result.direct.map(s=>s.id),['seed','meeting']);
 assert.ok(result.reviewedIds.includes('calendar'));
 assert.ok(!result.inspected.some(s=>s.id==='hidden'));
 assert.deepEqual(result.unverifiedIds,[]);
});
test('missing body can connect records but is never passed off as reviewed evidence',async()=>{
 const db=fakeDb({luna_notion_pages:[{page_id:'connector',title:'일정',archived:false}],
  luna_notion_chunks:[{page_id:'seed',position:0,text:relevant}],
  luna_notion_relations:[{from_page_id:'seed',to_page_id:'connector',property_name:'일정'}]});
 const result=await buildDocumentInventory(db,{query:'설치 자료',sources:[page('seed')],directory:[],review:reviewer});
 assert.deepEqual(result.unverifiedIds,['connector']);
 assert.deepEqual(result.direct.map(s=>s.id),['seed']);
});
test('deduplicates only identical complete bodies, retains changed versions and preferred source',async()=>{
 const sources=[{...page('backup'),title:'설계 검토',path_titles:['백업']},{...page('current'),title:'설계 검토',path_titles:['사업개발']},{...page('revision'),title:'설계 검토'}];
 let reviewedWindows=0;
 const db=fakeDb({luna_notion_chunks:sources.map((s,i)=>({page_id:s.id,position:0,text:relevant.repeat(4)+(i===2?' 변경된 설계':'' )}))});
 const result=await buildDocumentInventory(db,{query:'설치 자료',sources,directory:[],review:async rows=>{reviewedWindows+=rows.length;return reviewer(rows);}});
 assert.equal(reviewedWindows,2);
 assert.deepEqual(result.direct.map(s=>s.id),['current','revision']);
 assert.deepEqual(result.aliases,{backup:'current'});
 assert.ok(result.basis.current);
});
test('a verifier can reject a loosely related first-pass candidate',async()=>{
 const db=fakeDb({luna_notion_chunks:[{page_id:'a',position:0,text:relevant}]});
 const result=await buildDocumentInventory(db,{query:'설치 자료',sources:[page('a')],directory:[],review:reviewer,
  verify:async rows=>({direct:[],adjacent:[],unrelated:rows.map((_,i)=>i),evidence:[]})});
 assert.deepEqual(result.direct,[]);assert.deepEqual(result.reviewedIds,['a']);
});
test('named project locations are retained as locations while unrelated folder paths still require review',async()=>{
 const {buildDocumentInventory:build}=loadTs('lib/luna/document-inventory.ts',{
  '@/lib/luna/notion-project-directory':{requestedDirectoryProjects:()=>[{key:'빛마을',pageIds:['test']}],readDirectoryMaterials:async()=>[]}
 });
 const db=fakeDb({luna_notion_chunks:[{page_id:'test',position:0,text:'현장 시험\nT:\\Project\\빛마을\\Test\\현장 시험'},{page_id:'other',position:0,text:'T:\\Project\\다른사업\\Test'}]});
 const result=await build(db,{query:'빛마을 자료 찾아줘',sources:[{...page('test'),title:'현장 시험'},page('other')],directory:[],review:async rows=>({direct:[],adjacent:[],unrelated:rows.map((_,i)=>i),evidence:[]})});
 assert.deepEqual(result.direct.map(s=>s.id),['test']);
 assert.deepEqual(result.locationOnlyIds,['test']);
 assert.match(result.basis.test.reason,/원본 내용과 결과는 아직 확인하지 않음/);
});
test('a directory-selected project remains navigable when its first document is unrelated',async()=>{
 const db=fakeDb({luna_notion_chunks:[{page_id:'entry',position:0,text:'일반 소개'}, {page_id:'late',position:0,text:relevant}]});
 const result=await buildDocumentInventory(db,{query:'현장 자료',sources:[{...page('entry'),via_link:'project_directory',project_key:'actual'}],directory:[{key:'actual',pageIds:['entry','late']}],review:reviewer});
 assert.deepEqual(result.direct.map(s=>s.id),['late']);
 assert.deepEqual(result.reachedProjects,['actual']);
});
test('a navigation-only document opens related records but is never displayed as a project deliverable',async()=>{
 const db=fakeDb({luna_notion_pages:[{page_id:'meeting',title:'회의록',archived:false}],luna_notion_chunks:[{page_id:'index',position:0,text:'프로젝트 목록과 연결 문서'}, {page_id:'meeting',position:0,text:relevant}],luna_notion_relations:[{from_page_id:'index',to_page_id:'meeting',property_name:'자료'}]});
 const result=await buildDocumentInventory(db,{query:'관련 자료',sources:[page('index')],directory:[],review:async rows=>{
  if(rows[0].id.startsWith('index#')) return {direct:[],adjacent:[],navigation:[0],unrelated:[]};
  return reviewer(rows);
 }});
 assert.deepEqual(result.direct.map(s=>s.id),['meeting']);
 assert.ok(result.reviewedIds.includes('index'));
 assert.deepEqual(result.unverifiedIds,[]);
});
