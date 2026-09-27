const test = require('node:test');
const assert = require('node:assert/strict');
const {loadTs} = require('./helpers.cjs');
const {mergeNasTextEvidence} = loadTs('lib/luna/nas-evidence.ts');
const row = (path, drive='T', summary=null) => ({path,drive,type:'file',size_bytes:42,modified_at:'2026-09-25',file_summary:summary,importance:10});
test('existing directory hit receives matching body evidence without losing metadata',()=>{
 const original=row('Project\\Report.pdf');
 const result=mergeNasTextEvidence([original],[row('project/report.pdf','T','Budget approved')]);
 assert.equal(result.length,1);assert.equal(result[0].file_summary,'Budget approved');
 assert.equal(result[0].size_bytes,42);assert.equal(original.file_summary,null);
});
test('distinct drive paths remain separate and ambiguous unknown drives are not attached',()=>{
 const existing=[row('report.pdf','T'),row('report.pdf','P')];
 const result=mergeNasTextEvidence(existing,[row('report.pdf',null,'ambiguous')]);
 assert.equal(result.length,2);assert.ok(result.every(r=>r.file_summary===null));
 const separate=mergeNasTextEvidence([existing[0]],[row('report.pdf','P','partner')]);
 assert.equal(separate.length,2);assert.equal(separate[1].file_summary,'partner');
});
test('keyword and vector evidence are retained once with bounded context',()=>{
 let result=mergeNasTextEvidence([row('report.pdf','T','keyword')],[row('report.pdf',null,'vector')]);
 result=mergeNasTextEvidence(result,[row('report.pdf',null,'vector')]);
 assert.equal(result[0].file_summary,'keyword\nvector');
 result=mergeNasTextEvidence(result,[row('report.pdf',null,'x'.repeat(2000))]);
 assert.ok(result[0].file_summary.length<=1201);
});
