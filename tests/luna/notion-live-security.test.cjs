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
test('refresh keeps credentials paired with their saved revision during a simultaneous reconnect',async()=>{
 process.env.LUNA_NOTION_ENCRYPTION_KEY='test-only-32-character-encryption-key';
 let reads=0,savedRevision;const updates=[];
 const original={user_id:'a',notion_user_id:'notion-a',workspace_id:'workspace-a',revision:'old',expires_at:new Date(0).toISOString(),credentials:secure.seal({client_id:'client',access_token:'old-token',refresh_token:'refresh'},'a')};
 const db={from(){let mutation;const b={select(){return b},eq(){return b},or(){return b},maybeSingle(){return b},update(v){mutation=v;updates.push(v);return b},then(resolve){
  if(!mutation){reads++;return Promise.resolve({data:reads===1?original:{...original,revision:'other-grant',notion_user_id:'notion-b'},error:null}).then(resolve);}
  if(mutation.credentials){savedRevision=mutation.revision;return Promise.resolve({data:{...original,...mutation},error:null}).then(resolve);}
  return Promise.resolve({data:{user_id:'a'},error:null}).then(resolve);
 }};return b;}};
 let usedToken;
 const connection=loadTs('lib/luna/notion-live/connection.ts',{'node:crypto':crypto,'./crypto':secure,'./policy':policy,'./mcp':{NotionMcp:class{constructor(token){usedToken=token;}async initialize(){}}}});
 const oldFetch=global.fetch;
 global.fetch=async url=>new Response(JSON.stringify(String(url).includes('.well-known')?{authorization_endpoint:'https://mcp.notion.com/authorize',token_endpoint:'https://mcp.notion.com/token',registration_endpoint:'https://mcp.notion.com/register'}:{access_token:'new-token',expires_in:3600,user_id:'notion-a',workspace_id:'workspace-a'}),{headers:{'Content-Type':'application/json'}});
 try {const result=await connection.userMcp(db,'a');assert.equal(result.revision,savedRevision);assert.equal(result.notionUserId,'notion-a');assert.equal(usedToken,'new-token');assert.equal(reads,1);}
 finally {global.fetch=oldFetch;}
});

test('search arguments obey the live Notion highlight and result limits',()=>{
 const args=policy.scopedSearchArgs('test query');
 assert.equal(args.max_highlight_length,500);
 assert.ok(args.page_size>0 && args.page_size<=50);
});
