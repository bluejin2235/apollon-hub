const test = require('node:test'); const assert = require('node:assert/strict');
const {loadTs}=require('./helpers.cjs');
const {buildProjectNavigation,projectFileStep}=loadTs('lib/luna/project-navigation.ts');
const {combineScopeFollowup}=loadTs('lib/luna/clarify-followup.ts');
const {classifyDocumentRole}=loadTs('lib/luna/document-role.ts');
const root='01 사업개발/2025/250101 Sample';
const row=(path,more={})=>({drive:'T',path,id:1,scan_batch:'2026-01-01',modified_at:'2025-01-01',...more});
const q='Sample 전체 자료 찾아줘';
test('detail re-search keeps the last project and repeats from saved provenance, not stale topics',()=>{
 const history=[{role:'user',content:q},{role:'assistant',content:'inventory'}];
 const detail=combineScopeFollowup(history,'더 자세히 보여줘'); assert.equal(detail,q+'\n조건: 더 자세히 보여줘');
 const repeated=[...history,{role:'user',content:'더 자세히 보여줘'},{role:'assistant',metadata:{important_materials:{query:detail}}}];
 assert.equal(combineScopeFollowup(repeated,'그거보다 더 자세한 자료 찾아줘'),q+'\n조건: 그거보다 더 자세한 자료 찾아줘');
 assert.equal(combineScopeFollowup(history,'다른프로젝트 세부 자료 찾아줘'),null);
 assert.equal(combineScopeFollowup([...repeated,{role:'user',content:'오늘 날씨 알려줘'}],'더 자세히 보여줘'),null);
 assert.equal(combineScopeFollowup([{role:'user',content:'더 자세히 보여줘'},{role:'assistant',metadata:{important_materials:{query:22}}}],'더 자세히 보여줘'),null);
});
test('cost folder purpose wins over incidental design filename; actual design remains design',()=>{
 for (const path of ['Design/산출내역서_설계.pdf','00 Management/01 견적/01 비교견적/설치예술품설계.pdf','02 계약/선금서류/고객사송부.pdf']) {
  const c=classifyDocumentRole(path); assert.equal(c.role,'other'); assert.equal(c.purpose,'administrative');
 }
 assert.equal(classifyDocumentRole('01 Planning/250101 Plan B/media art design.pptx').role,'design');
});
test('detail follows the report phase, groups nested variants, excludes reference and commercial files',()=>{
 const docs=[row(root+'/01 Planning/250101 Ideation/A/concept.pptx'),row(root+'/01 Planning/250101 Ideation/B/concept.pptx'),
 row(root+'/01 Planning/250120 Plan B/design.pptx'),row(root+'/01 Planning/250131 고객보고/최종 보고.pptx'),
 row(root+'/00 Management/250121 비교견적/설계.pdf'), row(root+'/01 Planning/250105 Sample/reference design.pdf'),
 row('02 Project/2025/250201 Sample/02 Design/250801/최신 디자인.pptx')];
 const marks=[{drive:'T',path:root+'/01 Planning/250131 고객보고'}];
 const original=JSON.stringify(docs); const n=buildProjectNavigation(docs,marks,q+'\n조건: 더 자세히 보여줘');
 assert.deepEqual(n.trace.steps.map(s=>s.date),['2025-01-01','2025-01-20','2025-01-31']);
 assert.equal(n.trace.steps[0].folder,root+'/01 Planning/250101 Ideation');
 assert.ok(!n.selected.some(r=>r.path.includes('비교견적')||r.path.includes('Sample/reference')));
 assert.equal(n.trace.full_document_verified,false); assert.equal(n.trace.layer,2);
 assert.equal(n.trace.selection[0].source.scan_batch,'2026-01-01'); assert.equal(JSON.stringify(docs),original);
});
test('distinct dated reports in a flat folder are retained and invalid dates are not milestones',()=>{
 const docs=[row(root+'/02 Document/보고_250131.pptx'),row(root+'/02 Document/보고_250228.pptx')];
 const n=buildProjectNavigation(docs,[],q+'\n조건: 더 자세히 보여줘');
 assert.deepEqual(n.trace.steps.map(s=>s.date),['2025-01-31','2025-02-28']);
 assert.equal(projectFileStep(row(root+'/02 Document/보고_250230.pdf')).date,null);
});
test('overview preserves key roles and prefers same-priority project design over a later detail component',()=>{
 const docs=[row(root+'/01 Planning/250101/design.pptx'),row(root+'/02 Design/250601/fence_design.pptx'),row(root+'/02 Document/250201 Final Report/report.pptx')];
 const n=buildProjectNavigation(docs,[],q);
 assert.equal(n.selected.find(r=>classifyDocumentRole(r.path).role==='design').path,docs[0].path);
 const marked=buildProjectNavigation(docs,[{drive:'T',path:root+'/02 Design'}],q);
 assert.equal(marked.selected.find(r=>classifyDocumentRole(r.path).role==='design').path,docs[1].path);
});
