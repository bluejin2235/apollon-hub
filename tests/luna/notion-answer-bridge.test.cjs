const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {loadTs} = require('./helpers.cjs');
const policy = loadTs('lib/luna/notion-live/policy.ts');
const protocol = loadTs('lib/luna/notion-answer/protocol.ts', {'node:crypto': crypto, '@/lib/luna/notion-live/policy': policy});
const bridge = loadTs('lib/luna/notion-answer/bridge.ts', {'node:crypto': crypto, './protocol': protocol, '@/lib/luna/notion-live/policy': policy});
function fixture() {
  const now = Date.now();
  const request = {protocol: protocol.ANSWER_PROTOCOL, requestId: 'request-a', userId:'user-a', notionUserId:'notion-a', workspaceId:'workspace-a', connectionRevision:'rev-a', teamspaceId:policy.NOTION_TEAMSPACE_ID, question:'자료 찾아줘', issuedAt:now-1000, deadline:now+1000};
  const text = '  처음\n' + '가상의 검증 문장. '.repeat(1000) + '\n끝  ';
  const reply = {...request, status:'completed', source:'notion-personal-ai-browser', scope:{teamspaceIds:[policy.NOTION_TEAMSPACE_ID], externalSources:false, checkedBefore:true, checkedAfter:true}, chatUrl:'https://app.notion.com/chat?t=00000000000000000000000000000001', text, textSha256:protocol.digest(text), citations:[{title:'test',url:'https://app.notion.com/p/00000000000000000000000000000002'}], completedAt:now};
  return {request, reply, now};
}
test('full original text including whitespace survives, well beyond old snippet limit', () => {
  const {request,reply,now}=fixture();
  assert.equal(protocol.validateAnswer(reply,request,now).text,reply.text);
  assert.ok(reply.text.length>5000);
});
test('different accounts, requests, reconnects, questions and scopes fail closed', () => {
  const {request,reply,now}=fixture();
  for(const key of ['userId','notionUserId','workspaceId','requestId','connectionRevision','question','protocol']) assert.throws(()=>protocol.validateAnswer({...reply,[key]:'other'},request,now));
  for(const scope of [{...reply.scope,teamspaceIds:[]},{...reply.scope,teamspaceIds:['private']},{...reply.scope,teamspaceIds:[policy.NOTION_TEAMSPACE_ID,'other']},{...reply.scope,externalSources:true},{...reply.scope,checkedAfter:false}]) assert.throws(()=>protocol.validateAnswer({...reply,scope},request,now));
});
test('partial, expired, tampered, foreign and unsafe-source replies are rejected', () => {
  const {request,reply,now}=fixture();
  for(const bad of [{status:'running'},{source:'notion-mcp-search'},{text:reply.text.slice(0,500)},{completedAt:NaN},{completedAt:now+1},{chatUrl:'https://evil.example/chat?t=00000000000000000000000000000001'},{citations:[{title:'bad',url:'javascript:alert(1)'}]},{citations:[{title:'mail',url:'https://outlook.office.com/'}]}]) assert.throws(()=>protocol.validateAnswer({...reply,...bad},request,now));
  assert.throws(()=>protocol.validateAnswer(reply,request,request.deadline+1));
});
test('signatures bind exact UTF8 response bytes and reject other signing keys', () => {
  const raw=JSON.stringify(fixture().reply),key='test-only-long-key';
  const signature=protocol.sign(raw,key);
  assert.ok(protocol.verifySignature(raw,signature,key));
  assert.equal(protocol.verifySignature(raw+' ',signature,key),false);
  assert.equal(protocol.verifySignature(raw,signature,'another-key'),false);
  assert.equal(protocol.verifySignature(raw,null,key),false);
});
test('worker remains off by default; config is not chosen by request', () => {
  const saved={...process.env};
  try {
    delete process.env.LUNA_NOTION_ANSWER_PILOT;
    assert.throws(()=>bridge.bridgeConfig('user-a'),{code:'not_ready'});
    process.env.LUNA_NOTION_ANSWER_PILOT='1';
    process.env.LUNA_NOTION_ANSWER_PILOT_USERS='user-a';
    process.env.LUNA_NOTION_ANSWER_WORKER_URL='https://worker.example/answer';
    process.env.LUNA_NOTION_ANSWER_WORKER_KEY='test-only-key-00000000000000000000';
    assert.throws(()=>bridge.bridgeConfig('user-b'));
    for(const url of ['http://worker.example/answer','https://user:secret@worker.example/answer','https://worker.example/answer?token=secret']) {
      process.env.LUNA_NOTION_ANSWER_WORKER_URL=url;assert.throws(()=>bridge.bridgeConfig('user-a'));
    }
  } finally {for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('transport receives exact original answer, never credentials; failure does not invoke fallback', async () => {
  const saved={...process.env}, oldFetch=global.fetch;
  try {
    process.env.LUNA_NOTION_ANSWER_PILOT='1';process.env.LUNA_NOTION_ANSWER_PILOT_USERS='user-a';
    process.env.LUNA_NOTION_ANSWER_WORKER_URL='https://worker.example/answer';
    const key=process.env.LUNA_NOTION_ANSWER_WORKER_KEY='test-only-key-00000000000000000000';
    let calls=0;
    global.fetch=async (url,options)=>{
      calls++;assert.equal(url,'https://worker.example/answer');assert.equal(options.redirect,'error');
      assert.ok(protocol.verifySignature(options.body,options.headers['X-Luna-Signature'],key));
      assert.doesNotMatch(options.body,/credentials|access_token|cookie|password/);
      const sent=JSON.parse(options.body);
      const reply={...fixture().reply,...sent,completedAt:Date.now()};
      const raw=JSON.stringify(reply);
      return new Response(raw,{headers:{'X-Luna-Signature':protocol.sign(raw,key)}});
    };
    const identity={userId:'user-a',notionUserId:'notion-a',workspaceId:'workspace-a',connectionRevision:'rev-a'};
    assert.equal((await bridge.getOriginalNotionAnswer(identity,'자료 찾아줘',new AbortController().signal)).text,fixture().reply.text);
    global.fetch=async()=>{calls++;return new Response('failed',{status:503});};
    await assert.rejects(bridge.getOriginalNotionAnswer(identity,'자료 찾아줘',new AbortController().signal),{code:'worker_failed'});
    assert.equal(calls,2);
    const abort=new AbortController();abort.abort();
    await assert.rejects(bridge.getOriginalNotionAnswer(identity,'자료 찾아줘',abort.signal),{name:'AbortError'});
    assert.equal(calls,2);
  } finally {global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('pilot route checks login, admin access and reconnect before returning an answer', async () => {
  let user=null, allowed=false, reads=0, workerCalls=0, reconnect=false;
  const connection={notion_user_id:'notion-a',workspace_id:'workspace-a',revision:'rev-a'};
  const route=loadTs('app/api/luna/notion/answer/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),init)}},
    '@/lib/auth/get-api-user':{getApiUser:async()=>user,getServiceSupabase:()=>({})},
    '@/lib/luna/auth':{isSuperAdminUser:async()=>allowed},
    '@/lib/luna/notion-live/connection':{connectionRow:async()=>{reads++;return reconnect&&reads%2===0?{...connection,revision:'changed'}:connection;}},
    '@/lib/luna/notion-answer/bridge':{bridgeConfig:()=>({}),getOriginalNotionAnswer:async(identity,question)=>{workerCalls++;assert.equal(identity.userId,'user-a');assert.equal(identity.notionUserId,'notion-a');return {...fixture().reply,question};}},
    '@/lib/luna/notion-answer/protocol':protocol
  });
  const request=()=>new Request('https://hub.apollonworks.com/api/luna/notion/answer',{method:'POST',body:JSON.stringify({question:'자료 찾아줘',userId:'attacker',notionUserId:'attacker',teamspaceId:'private'})});
  assert.equal((await route.POST(request())).status,401);
  user={id:'user-a'};assert.equal((await route.POST(request())).status,403);assert.equal(workerCalls,0);
  allowed=true;const good=await route.POST(request());assert.equal(good.status,200);assert.equal((await good.json()).original_text,fixture().reply.text);
  reconnect=true;const blocked=await route.POST(request());assert.equal(blocked.status,502);const body=await blocked.json();assert.equal(body.code,'connection_changed');assert.equal(body.original_text,undefined);
});
