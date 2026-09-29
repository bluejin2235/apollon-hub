const test=require('node:test'),assert=require('node:assert/strict');
const {loadTs,fakeDb}=require('./helpers.cjs');
let loadedIds=[];
const page=(id,title)=>({page_id:id,title,url:'https://notion.so/'+id,path_titles:[],parent_id:null,nas_path:null,last_edited_time:null,excerpt:'주제와 연결된 원문'});
let pageRows=[];
const {loadNotionProjectDirectory,describeNotionProjectDirectory,bareDirectoryLookup,namedDirectorySubjects,selectDirectoryProjects,readDirectoryMaterials,requestedDirectoryProjects}=loadTs('lib/luna/notion-project-directory.ts',{
 './search-secondary':{loadPagesByIds:async (_db,ids)=>{loadedIds=ids;return new Map(pageRows.filter(p=>ids.includes(p.page_id)).map(p=>[p.page_id,p]));}},
 './keyword-token':{isSearchToken:t=>t.length>1}
});
test('a simple inventory resolves actual project names without converting a thematic task into a named project',()=>{
 const directory=[{key:'2024 03 빛마을 산책',pageIds:['a']}];
 for(const q of ['빛마을','빛마을 관련 자료 찾아줘','빛마을 관련 자료 모두 찾아줘']) assert.deepEqual(requestedDirectoryProjects(directory,q),directory);
 for(const q of ['야외 빛과 소리 관련 자료 모두 찾아줘','빛마을 설계 도면만 찾아줘','빛마을 비슷한 사례 자료 찾아줘']) assert.deepEqual(requestedDirectoryProjects(directory,q),[]);
});
test('bare actual project prefixes retrieve all matching projects without a forced choice',()=>{
 const directory=[{key:'230101 샘플 달빛산책',pageIds:['a']},{key:'230201 샘플 문화거리',pageIds:['b']}];
 assert.equal(bareDirectoryLookup(directory,'샘플'),'샘플 관련 자료 모두 찾아줘');
 assert.equal(bareDirectoryLookup(directory,'없는곳'),null);
 assert.equal(bareDirectoryLookup(directory,'샘플 뜻이 뭐야'),null);
 assert.equal(bareDirectoryLookup(directory,'샘플 비슷한 사례'),null);
 assert.equal(bareDirectoryLookup(directory,'네'),null);
});
test('directory descriptions use only active member titles and preserve test and design stages',async()=>{
 const rows=[...Array.from({length:8},(_,i)=>({page_id:'i'+i,title:'아이데이션 '+i,archived:false})),{page_id:'t',title:'현장 조명 테스트',archived:false},{page_id:'d',title:'공간 설계',archived:false},{page_id:'old',title:'삭제된 문서',archived:true},{page_id:'outside',title:'다른 프로젝트 문서',archived:false}];
 const description=await describeNotionProjectDirectory(fakeDb({luna_notion_pages:rows}),[{key:'샘플 산책로',pageIds:rows.filter(r=>r.page_id!=='outside').map(r=>r.page_id)}]);
 assert.match(description,/현장 조명 테스트/); assert.match(description,/공간 설계/);
 assert.doesNotMatch(description,/삭제된 문서|다른 프로젝트 문서/);
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
 assert.equal(db.calls.filter(c=>c.table==='luna_links').length,2);
 assert.deepEqual(selectDirectoryProjects(directory,[-1,0,0,99,'0']),[directory[0]]);
});
test('navigation preserves distinct document stages and project coverage without reading other memberships',async()=>{
 pageRows=[...Array.from({length:10},(_,i)=>page('a'+i,'아이데이션 '+i)),page('at','현장 테스트'),page('af','최종 보고'),page('ad','설계 도서'),page('b','다른 관련 프로젝트 회의'),page('secret','선택하지 않은 문서')];
 const projects=[{key:'A',pageIds:pageRows.filter(p=>p.page_id.startsWith('a')).map(p=>p.page_id)},{key:'B',pageIds:['b']}];
 const sources=await readDirectoryMaterials({},projects,'조성 자료 모두 찾아줘');
 assert.equal(sources[1].id,'b');
 for(const id of ['at','af','ad']) assert.ok(sources.some(s=>s.id===id));
 assert.ok(!loadedIds.includes('secret')); assert.equal(sources.length,14);
 assert.ok(sources.every(s=>s.via_link==='project_directory'&&s.url.includes(s.id)));
});
