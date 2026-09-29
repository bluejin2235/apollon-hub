const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
let loadedIds=[];
const page=(id,title)=>({page_id:id,title,url:'https://notion.so/'+id,path_titles:[],parent_id:null,nas_path:null,last_edited_time:null,excerpt:'주제와 연결된 원문'});
let pageRows=[];
const {loadNotionProjectDirectory,namedDirectorySubjects,selectDirectoryProjects,readDirectoryMaterials}=loadTs('lib/luna/notion-project-directory.ts',{
 './search-secondary':{loadPagesByIds:async (_db,ids)=>{loadedIds=ids;return new Map(pageRows.filter(p=>ids.includes(p.page_id)).map(p=>[p.page_id,p]));}},
 './keyword-token':{isSearchToken:t=>t.length>1}
});
test('exact directory names scope named requests but not topic or comparable-example requests',()=>{
 const directory=[{key:'230101 샘플 오피스 라운지',pageIds:['a']},{key:'240101 다른 오피스 라운지',pageIds:['b']},{key:'2023',pageIds:['c']}];
 assert.deepEqual(namedDirectorySubjects(directory,'샘플 오피스 라운지 미디어아트 제안 관련 자료 모두 찾아줘'),['샘플 오피스 라운지']);
 assert.deepEqual(namedDirectorySubjects(directory,'야외 숲 미디어아트 조성관련 자료 모두 찾아줘'),[]);
 assert.deepEqual(namedDirectorySubjects(directory,'샘플 오피스 라운지와 비슷한 사례 모두 찾아줘'),[]);
 assert.deepEqual(namedDirectorySubjects(directory,'240101 샘플 오피스 라운지 자료 모두 찾아줘'),[]);
 const {filterCardsByAsked}=loadTs('lib/luna/search-filter.ts');
 const asked={projectPhrases:namedDirectorySubjects(directory,'샘플 오피스 라운지 자료 모두 찾아줘'),extraTokens:[],nature:'any',material:'any'};
 const images=[{type:'image',title:'설치 이미지',raw_path:'T:/230101 샘플 오피스 라운지/Design/a.jpg'},{type:'image',title:'설치 이미지',raw_path:'T:/240101 다른 오피스 라운지/Design/a.jpg'}];
 assert.deepEqual(filterCardsByAsked(images,asked),[images[0]]);
});
test('directory follows only active accepted Notion project membership, with pagination',async()=>{
 const link=(from_id,to_id,extra={})=>({from_id,to_id,kind:'belongs',from_type:'notion_page',to_type:'project',status:'active',confidence:0.8,...extra});
 const rows=Array.from({length:1001},(_,i)=>link(String(i),'project'));
 rows.push(link('inactive','bad',{status:'candidate'}),link('weak','bad',{confidence:0.4}),link('external','bad',{from_type:'nas'}));
 const db=fakeDb({luna_links:rows}); const directory=await loadNotionProjectDirectory(db);
 assert.equal(directory.length,1); assert.equal(directory[0].pageIds.length,1001);
 assert.equal(db.calls.length,2);
 assert.deepEqual(selectDirectoryProjects(directory,[-1,0,0,99,'0']),[directory[0]]);
});
test('navigation preserves distinct document stages and project coverage without reading other memberships',async()=>{
 pageRows=[...Array.from({length:10},(_,i)=>page('a'+i,'아이데이션 '+i)),page('at','현장 테스트'),page('af','최종 보고'),page('ad','설계 도서'),page('b','다른 관련 프로젝트 회의'),page('secret','선택하지 않은 문서')];
 const projects=[{key:'A',pageIds:pageRows.filter(p=>p.page_id.startsWith('a')).map(p=>p.page_id)},{key:'B',pageIds:['b']}];
 const sources=await readDirectoryMaterials({},projects,'조성 자료 모두 찾아줘');
 assert.equal(sources[1].id,'b');
 for(const id of ['at','af','ad']) assert.ok(sources.some(s=>s.id===id));
 assert.ok(!loadedIds.includes('secret')); assert.ok(sources.length<=16);
 assert.ok(sources.every(s=>s.via_link==='project_directory'&&s.url.includes(s.id)));
});
