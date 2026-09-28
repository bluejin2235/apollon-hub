const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const { buildSecondaryDocumentProfile: build, profileFreshness } = loadTs('lib/luna-admin/secondary-document-profile.ts', { 'node:crypto': require('node:crypto') });
const { documentRole } = loadTs('lib/luna/nas-priority.ts');
const root = '02 Project/2026/260101 Sample 시즌1';
const source = { id: 1, drive: 'T', path: root + '/Design/interview.docx', type: 'file', size_bytes: 20,
 modified_at: '2026-01-01T00:00:00Z', scan_batch: '2026-09-28T00:00:00Z', importance: 0, marked_reason: null };
const link = { id: 'link1', from_type: 'nas_path', from_id: 'T:/' + source.path, to_type: 'project', to_id: '260101 Sample 시즌1', kind: 'belongs', status: 'active', evidence: { to_path: 'T:/' + root, role: 'file' } };
const commit = 'a'.repeat(40), at = '2026-09-28T00:00:00Z';
const mark = { id: 9, drive: 'T', path: root + '/Design', note: 'important', created_at: at };
test('shared policy separates interview and receipt purpose from design folder cues', () => {
 for (const leaf of ['인터뷰 질문지.docx','디자인 인터뷰.docx','캡션 영수증.pdf','invoice.pdf']) assert.equal(documentRole(root + '/월간디자인/' + leaf), 'other');
 assert.equal(documentRole(root + '/Design/조경디자인.pdf'), 'design');
 assert.equal(documentRole(root + '/Design/manual.pdf'), 'operations');
 assert.equal(documentRole(root + '/Reference/디자인.pdf'), 'reference');
});
test('layer 2 preserves versioned primary evidence and conflict without changing legacy edge or claiming verification', () => {
 const before = JSON.stringify({source, link, mark}); const p = build(link, source, [mark], commit, at);
 assert.equal(p.layer, 2); assert.equal(p.review_state, 'candidate'); assert.equal(p.verified_at, null);
 assert.deepEqual(p.conflicts, ['filename-folder-role']); assert.equal(p.claims.document_role.role, 'other');
 assert.equal(p.claims.document_role.state, 'inferred'); assert.deepEqual(p.claims.importance.manual_mark_ids, ['9']);
 assert.equal(p.claims.season.value, 1); assert.equal(p.claims.season.state, 'inferred');
 assert.equal(p.inputs.primary.scan_batch, source.scan_batch); assert.equal(p.generator_commit, commit);
 assert.equal(JSON.stringify({source, link, mark}), before);
 assert.equal(build(link, source, [mark], commit, '2026-09-29T00:00:00Z').revision_key, p.revision_key);
});
test('freshness includes moves, source revision, mark edits/additions/removal, and rule version; missing is not deleted', () => {
 const p = build(link, source, [mark], commit, at);
 assert.equal(profileFreshness(p, source, [mark]), 'current');
 for (const patch of [{path: source.path+'x'}, {scan_batch: 'next'}, {size_bytes:21}, {modified_at:'next'}, {importance:1}, {id:2}]) assert.equal(profileFreshness(p, {...source,...patch}, [mark]), 'stale');
 assert.equal(profileFreshness(p, source, [{...mark,note:'changed'}]), 'stale');
 assert.equal(profileFreshness(p, source, []), 'stale');
 assert.equal(profileFreshness(build(link, source, [], commit, at), source, [mark]), 'stale');
 assert.equal(profileFreshness({...p,policy:{...p.policy,role:'old'}}, source, [mark]), 'stale');
 assert.equal(profileFreshness(p, null, [mark]), 'unavailable'); assert.equal(profileFreshness(p, source, null), 'unavailable');
});
test('drive/root mismatch and incomplete snapshots cannot produce a saved profile', () => {
 assert.throws(() => build(link, {...source,drive:'P'}, [], commit, at), /identity/);
 assert.throws(() => build({...link,evidence:{to_path:'T:/'+root+' sibling'}},source,[],commit,at), /reconciliation/);
 assert.throws(() => build(link, {...source,scan_batch:null}, [], commit, at), /Incomplete/);
 assert.throws(() => build(link,source,[],'main',at), /provenance/);
});
test('a seasonless year is not a season and a conflicting label is not unified', () => {
 const s = {...source,path:source.path.replace(' 시즌1','')};
 const l = {...link,from_id:'T:/'+s.path,to_id:link.to_id.replace(' 시즌1',''),evidence:{to_path:'T:/'+root.replace(' 시즌1','')}};
 assert.equal(build(l,s,[],commit,at).claims.season.state,'unknown');
 const conflictSource={...source,path:root+'/시즌3/design.pdf'};
 const p=build({...link,from_id:'T:/'+conflictSource.path},conflictSource,[],commit,at);
 assert.equal(p.claims.season.state,'conflict'); assert.equal(p.claims.season.value,null);
 assert.deepEqual(p.conflicts,['multiple-season-labels']);
});
