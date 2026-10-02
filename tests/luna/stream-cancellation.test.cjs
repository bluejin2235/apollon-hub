const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers.cjs');
const engine = {
  readOpenAiUsage: u => u, emptyUsage: () => ({}),
  getTierModel: async () => ({model_id:'gpt-5.6-luna'}),
  resolveProviderModel: m => ({...m,provider:'openai'}), bumpUsageDaily: () => {}
};
const { llmComplete, lunaLlmComplete, llmStreamText } = loadTs('lib/luna/llm/client.ts', {
  '@anthropic-ai/sdk': {}, '@/lib/luna/engine': engine,
  '@/lib/luna/notify': {},
  '@/lib/luna/prompt-cache': {flattenSystem: s => s, shouldApplyPromptCache: () => false},
  '@/lib/luna/env-keys': {openaiApiKey: () => 'test-only-placeholder'}
});
test('streaming forwards caller cancellation to the provider request', async t => {
  const abort = new AbortController(); let providerSignal;
  t.mock.method(globalThis,'fetch',async (_url,init) => {
    providerSignal=init.signal;
    abort.abort();
    init.signal.throwIfAborted();
  });
  await assert.rejects(async()=>{for await (const _ of llmStreamText({provider:'openai',model_id:'gpt-5.6-luna',user:'question',signal:abort.signal})) {}}, {name:'AbortError'});
  assert.equal(providerSignal.aborted,true);
});
