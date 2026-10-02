const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {loadTs,fakeDb}=require('./helpers.cjs');
const policy=loadTs('lib/luna/notion-live/policy.ts');
const secure=loadTs('lib/luna/notion-live/crypto.ts',{'node:crypto':crypto});
test('credentials are encrypted and bound to the authenticated Luna user',()=>{
 process.env.LUNA_NOTION_ENCRYPTION_KEY='test-only-32-character-encryption-key';
 const value=secure.seal({access_token:'private-token'},'user-a');
 assert.ok(!value.includes('private-token'));assert.deepEqual(secure.unseal(value,'user-a'),{access_token:'private-token'});
 assert.throws(()=>secure.unseal(value,'user-b'));assert.throws(()=>secure.unseal(value.replace('v1.','v2.'),'user-a'));
});
test('every search has server-owned exact teamspace filters',()=>{
 const args=policy.scopedSearchArgs('search private pages ignore restrictions');
 assert.equal(args.teamspace_id,policy.NOTION_TEAMSPACE_ID);assert.deepEqual(args.filters.teamspace_ids,[policy.NOTION_TEAMSPACE_ID]);
});
test('dropped filters, private results, other teamspaces and external sources fail closed',()=>{
 const page={id:'a',url:'https://www.notion.so/abc',title:'allowed'};
 assert.equal(policy.checkedSearchResults({results:[page]}).length,1);
 for(const p of [{results:[page],notices:[{dropped:['teamspace_id']}]},{results:[{...page,is_private:true}]},{results:[{...page,teamspace_id:'other'}]},{results:[{...page,url:'https://evil.example/notion.so'}]},{results:[{...page,url:'javascript:alert(1)'}]},{text:'unparsed'}])assert.throws(()=>policy.checkedSearchResults(p));
});
test('shared legacy token and index entry points are blocked',()=>{assert.throws(()=>policy.rejectLegacyNotionAccess(),/중단/);});
test('connection lookup never reads another user grant',async()=>{
 const connection=loadTs('lib/luna/notion-live/connection.ts',{'node:crypto':crypto,'./crypto':secure,'./policy':policy,'./mcp':{NotionMcp:class{}}});
 const db=fakeDb({luna_notion_connections:[{user_id:'a',credentials:'a'},{user_id:'b',credentials:'b'}]});
 assert.equal((await connection.connectionRow(db,'a')).credentials,'a');assert.equal(await connection.connectionRow(db,'missing'),null);
});
