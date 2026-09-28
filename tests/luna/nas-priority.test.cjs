const test=require('node:test');const assert=require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {nasPriority,rankNasPriority,buildPriorityProfile,diversePriorityFiles,broadProjectSubject,documentRole}=loadTs('lib/luna/nas-priority.ts');
const {groundedProjectRoots,retrieveImportantProjectMaterials}=loadTs('lib/luna/important-project-materials.ts');
const base='02 Project\\2021\\05 샘플센터';
const marks=[{drive:'T',path:base+'\\02 Document'},{drive:'T',path:base+'\\09 운영'}];
const row=(path,patch={})=>({drive:'T',path,importance:0,modified_at:'2026-01-01T00:00:00Z',...patch});
test('marks inherit to new descendants but never another drive or sibling prefix',()=>{
 assert.equal(nasPriority(row(base+'\\02 Document\\new.pptx'),marks).manual,true);
 assert.equal(nasPriority(row(base+'/02 Document/new.pptx'),marks).manual,true);
 assert.equal(nasPriority(row(base+'\\02 Document\\new.pptx',{drive:'P'}),marks).manual,false);
 assert.equal(nasPriority(row(base+'\\02 Document Other\\new.pptx'),marks).manual,false);
});
test('inferred folder role is learned from marks and never presented as a manual mark',()=>{
 const samples=[{drive:'T',path:'02 Project/2024/A/제안서'},{drive:'P',path:'02 Project/2025/B/최종 제안'}];
 const p=nasPriority(row('02 Project/2026/C/제안/new.pptx'),samples);
 assert.equal(buildPriorityProfile(samples).roles.proposal,2);
 assert.equal(p.inferred,true);assert.equal(p.manual,false);assert.equal(p.level,1);
});
test('later marked candidate outranks the alphabetical prefix before applying a job limit',()=>{
 const first=row('02 Project/2021/00 Sample/제안서.pptx');
 const later=row(base+'\\02 Document\\final.pptx');
 assert.deepEqual(rankNasPriority([first,later],marks,1),[later]);
});
test('core categories precede operations and references do not become core design evidence',()=>{
 const docs=[row(base+'/09 운영/manual.pdf'),row(base+'/02 Document/컨셉안.pdf'),row(base+'/02 Document/제안서.pptx'),row(base+'/02 Document/참고/design.pdf')];
 assert.deepEqual(diversePriorityFiles(docs,marks).map(x=>documentRole(x.path)),['proposal','concept','operations']);
});
test('a Design folder does not turn permit paperwork into core design; dated versions retain order',()=>{
 assert.equal(documentRole(base+'/04 Design/심의/관리카드.pdf'),'review');
 assert.equal(documentRole(base+'/02 Document/Garden/조경디자인.pdf'),'design');
 const old=row(base+'/02 Document/제안_210415.pptx',{modified_at:'2026-09-01T00:00:00Z'});
 const newer=row(base+'/02 Document/제안_210527_final.pptx');
 assert.deepEqual(rankNasPriority([old,newer],marks),[newer,old]);
});
test('unknown broad subject resolves only from matching source title with a grounded drive and project root',()=>{
 const source={id:'s',title:'샘플 미디어 센터 CMS',paths:['T:/'+base.replaceAll('\\','/')+'/09 운영'],parent_id:'project-parent'};
 const query='샘플미디어센터 전체 자료 찾아줘';
 assert.equal(broadProjectSubject(query),'샘플미디어센터');
 assert.deepEqual(groundedProjectRoots(query,[source],marks),[{drive:'T',path:base}]);
 assert.deepEqual(groundedProjectRoots('다른센터 전체 자료 찾아줘',[source],marks),[]);
 assert.equal(broadProjectSubject('운영 매뉴얼 찾아줘'),null);
});
test('project inventory follows exact Notion parent to proposal phase and preserves core files',async()=>{
 const proposal='01 사업개발\\2021\\210101 샘플센터';
 const calls=[];
 const admin={from(table){const filters=[];let cap=Infinity;const q={
  select(){return q},or(){return q},eq(k,v){filters.push([k,'eq',v]);return q},gte(k,v){filters.push([k,'gte',v]);return q},lt(k,v){filters.push([k,'lt',v]);return q},
  ilike(k,v){filters.push([k,'ilike',v]);return q},order(){return q},limit(v){cap=v;return q},
  then(resolve,reject){calls.push({table,filters});let rows=table==='nas_important_paths'?marks:table==='luna_notion_pages'?
   [{page_id:'proposal',title:'샘플센터 Initial Report',url:'https://example.test/proposal',parent_id:'project-parent',archived:false,nas_path:'T:\\'+proposal+'\\제안서'},
    {page_id:'unrelated',title:'샘플센터 증축',url:'https://example.test/extension',parent_id:'another-parent',archived:false,nas_path:null}]:
   [row(base+'\\02 Document\\컨셉안.pptx',{type:'file'}),row(base+'\\09 운영\\manual.pdf',{type:'file'}),row(proposal+'\\제안서\\Initial Report.pptx',{type:'file'}),row('02 Project\\2025\\증축\\wrong.pdf',{type:'file'})];
   rows=rows.filter(r=>filters.every(([k,op,v])=>op==='eq'?r[k]===v:op==='gte'?r[k]>=v:op==='lt'?r[k]<v:String(r[k]??'').includes(v.slice(1,-1))));
   return Promise.resolve({data:rows.slice(0,cap),error:null}).then(resolve,reject);
  }};return q;}};
 const source={id:'cms',title:'샘플미디어센터 CMS',paths:['T:\\'+base+'\\09 운영'],parent_id:'project-parent'};
 const result=await retrieveImportantProjectMaterials(admin,'샘플미디어센터 전체 자료 찾아줘',[source]);
 assert.equal(result.cards[0].title,'Initial Report.pptx');
 assert.ok(result.cards.some(c=>c.title==='컨셉안.pptx'));
 assert.ok(result.cards.some(c=>c.title==='manual.pdf'));
 assert.ok(!result.cards.some(c=>c.title==='wrong.pdf'));
 assert.deepEqual(result.sources.map(s=>s.id),['proposal']);
 assert.equal(result.trace.linked_roots.length,1);
 assert.match(result.prompt,/본문을 읽었다고/);
 assert.ok(calls.find(c=>c.table==='luna_notion_pages').filters.some(([k,,v])=>k==='parent_id'&&v==='project-parent'));
});
