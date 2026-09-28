const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { requestedSeason, groundedSeasonSources, matchesSeasonSubject } = loadTs('lib/luna/season-scope.ts');
const { groundedProjectRoots } = loadTs('lib/luna/important-project-materials.ts');
const { scopeMediaToEvidence } = loadTs('lib/luna/media-evidence-scope.ts');
const { filterRetrievedByAsked } = loadTs('lib/luna/search-filter.ts');
const { parseAskedWhat } = loadTs('lib/luna/ask-what.ts');
const subject = '샘플리조트 시즌 1';
const query = subject + ' 전체 자료 찾아줘';
const root = '01 사업개발/2023/230101 샘플리조트 콘텐츠';
const execution = '02 Project/2023/230201 샘플리조트 제작';
const sources = [
 {id:'a-b',title:'01 샘플리조트 콘텐츠제작 시즌1',parent_id:'archive',nas_path:'T:/'+root+'/Document'},
 {id:'proposal',title:'컨셉 제안서',parent_id:'ab',nas_path:'T:/'+root+'/제안서'},
 {id:'design',title:'디자인 보고',parent_id:'a-b',nas_path:'T:/'+execution+'/Design'},
 {id:'sibling',title:'샘플리조트 시즌3 제안서',parent_id:'archive',nas_path:'T:/02 Project/2025/샘플리조트 시즌3/제안'},
 {id:'cross',title:'시즌2 참고',parent_id:'a-b',nas_path:'T:/'+root+'/시즌2'},
 {id:'mention',title:'다른 프로젝트',excerpt:'샘플리조트 시즌1 사례',nas_path:'T:/02 Project/2023/다른 프로젝트/Design'}
];
test('season labels do not depend on adjacent project words and mixed requests stay broad', () => {
 assert.equal(matchesSeasonSubject(sources[0].title,subject),true);
 assert.equal(matchesSeasonSubject('샘플리조트 제작 Season_1',subject),true);
 assert.equal(matchesSeasonSubject('샘플리조트 S10',subject),false);
 assert.equal(requestedSeason('샘플리조트 시즌1과 시즌3 비교'),null);
});
test('seasonless proposal and execution roots inherit only an exact parent or verified root', () => {
 assert.deepEqual(groundedSeasonSources(subject,sources).map(s=>s.id),['a-b','proposal','design']);
 assert.deepEqual(groundedProjectRoots(query,sources,[]),[{drive:'T',path:root},{drive:'T',path:execution}]);
 assert.deepEqual(groundedSeasonSources('없는프로젝트 시즌1',sources),[]);
});
test('season scope rejects wrong-season media even with a known project and high similarity', () => {
 const cards=[{type:'image',title:'main.png',drive:'T',raw_path:execution+'/main.png'},
 {type:'image',title:'wrong.png',drive:'T',raw_path:'02 Project/2025/샘플리조트 시즌3/wrong.png',similarity:.99},
 {type:'image',title:'reference.png',drive:'P',raw_path:execution+'/reference.png'},
 {type:'nas',title:'proposal'}];
 const asked={projectPhrases:['샘플리조트']};
 assert.deepEqual(scopeMediaToEvidence(cards,query,sources,asked).map(c=>c.title),['main.png','proposal']);
 assert.deepEqual(scopeMediaToEvidence(cards,query,[],asked).map(c=>c.title),['proposal']);
});
test('broad document requests reject explicit conflicts but incidental body mentions do not erase source identity', () => {
 const asked=parseAskedWhat(query,[]);
 const bundle={cards:[{type:'nas',title:'샘플리조트 시즌3 제안서'},{type:'image',title:'샘플리조트 S2 이미지'}],
 notion:[{id:'one',title:subject,excerpt:'다음 시즌3를 참고한다'},{id:'three',title:'샘플리조트 시즌3',excerpt:'시즌1과 비교'}],
 wiki:[],nas:[{path:root+'/제안서.pptx'},{path:'02 Project/2025/샘플리조트 시즌3/제안.pptx'}]};
 const filtered=filterRetrievedByAsked(bundle,asked);
 assert.equal(filtered.cards.length,0);
 assert.deepEqual(filtered.notion.map(s=>s.id),['one']);
 assert.deepEqual(filtered.nas.map(s=>s.path),[root+'/제안서.pptx']);
});
test('inventory expands children of the season project, never the common archive parent', async () => {
 const { retrieveImportantProjectMaterials }=loadTs('lib/luna/important-project-materials.ts');
 const calls=[];
 const pages=[{page_id:'proposal',title:'컨셉 제안',url:'https://example.test/p',nas_path:'T:/'+root+'/제안',parent_id:'a-b',archived:false},
  {page_id:'wrong',title:'시즌3 제안',url:'https://example.test/wrong',nas_path:'T:/02 Project/2025/샘플리조트 시즌3/제안',parent_id:'archive',archived:false}];
 const files=[{drive:'T',path:root+'/제안/제안서.pptx',type:'file',importance:1},
  {drive:'T',path:root+'/시즌3/디자인.pptx',type:'file',importance:1}];
 const db={from(table){const filters=[];let cap=Infinity;const q={select(){return q},or(){return q},order(){return q},
  eq(k,v){filters.push([k,'eq',v]);return q},gte(k,v){filters.push([k,'gte',v]);return q},lt(k,v){filters.push([k,'lt',v]);return q},
  ilike(k,v){filters.push([k,'ilike',v]);return q},limit(n){cap=n;return q},then(resolve,reject){
   calls.push({table,filters});const rows=table==='nas_important_paths'?[]:table==='luna_notion_pages'?pages:files;
   return Promise.resolve({error:null,data:rows.filter(r=>filters.every(([k,op,v])=>op==='eq'?r[k]===v:op==='gte'?r[k]>=v:op==='lt'?r[k]<v:String(r[k]??'').includes(v.slice(1,-1)))).slice(0,cap)}).then(resolve,reject);
  }};return q;}};
 const result=await retrieveImportantProjectMaterials(db,query,[{...sources[0],url:'https://example.test/project'}]);
 assert.deepEqual(result.cards.map(c=>c.title),['제안서.pptx']);
 assert.ok(result.sources.some(s=>s.id==='a-b'));
 assert.ok(!result.sources.some(s=>s.id==='wrong'));
 assert.ok(calls.filter(c=>c.table==='luna_notion_pages').every(c=>c.filters.some(([k,,v])=>k==='parent_id'&&v==='a-b')));
});
