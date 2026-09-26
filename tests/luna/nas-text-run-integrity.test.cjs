const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const stamp = '2026-09-25T00:00:00Z';
const file = name => ({ drive: 'T', path: name + '.pptx', size_bytes: 100, modified_at: stamp });
const previous = (row, status) => ({ ...row, status, content_hash: 'same-text', updated_at: stamp });

async function runCli({ rows = [file('sample')], existing = [], statuses = {},
  args = [], insertError = false, runId = 'run', incompletePaths = [], sourceChanges = false, statFails = false } = {}) {
  const events = [];
  const extracted = [];
  const logs = [];
  const errors = [];
  let exit = 0;
  let stats = 0;
  const admin = {
    async rpc(name, params) {
      if (name === 'nas_text_incomplete_paths') return {data:incompletePaths,error:null};
      assert.equal(name, 'nas_text_publish');
      events.push({ operation: 'rpc', payload: params });
      return insertError ? { error: {message: 'simulated atomic publication failure'} } : {
        data: { updated_at: stamp, chunks_created: params.p_chunks.length }, error: null
      };
    },
    from(table) {
    let operation = 'read';
    let payload;
    const filters = {};
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, ilike() { return q; },
      eq(key, value) { filters[key] = value; return q; },
      upsert(row) { operation = 'upsert'; payload = row; return q; },
      delete() { operation = 'delete'; return q; },
      insert(row) { operation = 'insert'; payload = row; return q; },
      maybeSingle: async () => ({ data: rows.some(row => row.drive === filters.drive) ? { scan_batch: stamp } : null }),
      range: async (from, to) => ({ data: (table === 'nas_directory'
        ? rows.filter(row => row.drive === filters.drive) : existing).slice(from, to + 1) }),
      then(resolve, reject) {
        if (operation === 'read') throw Error('Unexpected query ' + table);
        events.push({ table, operation, payload, filters: { ...filters } });
        return Promise.resolve({ error: insertError && table === 'nas_file_chunks' &&
          operation === 'insert' ? { message: 'simulated chunk write failure' } : null }).then(resolve, reject);
      }
    };
    return q;
  } };
  const dependencies = {
    '@/lib/luna/nas-text-store': require('./helpers.cjs').loadTs('lib/luna/nas-text-store.ts'),
    '@/lib/luna/nas-error': require('./helpers.cjs').loadTs('lib/luna/nas-error.ts'),
    dotenv: { config() {} },
    'node:path': { resolve: () => '/unused' },
    'node:fs': { existsSync: () => true, statSync: () => {
      if (statFails) throw new Error('EACCES');
      stats++; return { size: sourceChanges && stats > 1 ? 101 : 100, mtime: new Date(stamp) };
    } },
    '@supabase/supabase-js': { createClient: () => admin },
    '@/lib/luna/nas-text': {
      extOfNasPath: () => 'pptx', isBackupPath: () => false, resolveNasFullPath: (_drive, name) => name,
      sanitizeNasText: text => text, hashNasText: () => 'same-text',
      chunkNasText: text => ({ chunks: [text], truncated: false }),
      extractNasFileText: async name => {
        extracted.push(name);
        const status = statuses[name] || 'ok';
        return { status, text: status === 'ok' ? 'fixture evidence' : '', error: 'simulated failure' };
      }
    },
    '@/lib/luna/nas-text-runs': {
      startNasTextRun: async (_admin, kind, count) => { events.push({ start: true, kind, count }); return runId; },
      updateNasTextRunProgress: async () => {},
      finishNasTextRun: async (_admin, _id, status, progress) => events.push({ status, progress: { ...progress } })
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/index-nas-text.ts'), 'utf8');
  assert.ok(source.includes('main().catch((e) => {'));
  const code = ts.transpileModule(source.replace('main().catch((e) => {',
    'globalThis.completion = main().catch((e) => {'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
  const context = {
    require: name => { if (!(name in dependencies)) throw Error('Unmocked dependency: ' + name); return dependencies[name]; },
    exports: {}, console: { log: (...values) => logs.push(values.join(' ')), warn() {}, error: error => errors.push(String(error)) },
    process: { argv: ['node', 'script', ...args],
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'test-placeholder' },
      cwd: () => '/unused', exit: code => { exit = code; } }
  };
  vm.runInNewContext(code, context);
  await context.completion;
  return { exit, events, extracted, logs, errors };
}

test('failed extraction is retried with unchanged source metadata', async () => {
  const row = file('retry');
  const result = await runCli({ rows: [row], existing: [previous(row, 'failed')] });
  assert.deepEqual(result.extracted, [row.path]);
  assert.equal(result.exit, 0, result.errors.join('\n'));
  const outcome = result.events.find(event => event.status);
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.progress.ok, 1);
});
test('unchanged completed empty and skipped files remain excluded by resume', async () => {
  for (const status of ['ok', 'empty', 'skipped']) {
    const row = file(status);
    const result = await runCli({ rows: [row], existing: [previous(row, status)] });
    assert.deepEqual(result.extracted, []);
    assert.equal(result.exit, 0, result.errors.join('\n'));
  }
});
test('newer files are still processed regardless of previous status', async () => {
  for (const status of ['ok', 'empty', 'skipped', 'failed']) {
    const row = file(status);
    const result = await runCli({ rows: [row], existing: [{
      ...previous(row, status), modified_at: '2026-09-24T00:00:00Z'
    }] });
    assert.deepEqual(result.extracted, [row.path]);
  }
});
test('explicit no-resume still processes unchanged successful files', async () => {
  const row = file('force');
  const result = await runCli({ rows: [row], existing: [previous(row, 'ok')], args: ['--no-resume'] });
  assert.deepEqual(result.extracted, [row.path]);
  assert.equal(result.exit, 0, result.errors.join('\n'));
});
test('partial extraction failure preserves successes but exits failed without a done record', async () => {
  const result = await runCli({ rows: [file('good'), file('bad')], statuses: { 'bad.pptx': 'failed' } });
  assert.equal(result.exit, 1);
  assert.ok(!result.events.some(event => event.status === 'done'));
  const outcome = result.events.find(event => event.status === 'failed');
  assert.equal(outcome.progress.ok, 1);
  assert.equal(outcome.progress.failed, 1);
  assert.equal(outcome.progress.chunksCreated, 1);
});
test('publication failure cannot become completion or trigger fallback writes', async () => {
  const result = await runCli({ insertError: true });
  assert.ok(!result.events.some(event => ['upsert','delete','insert'].includes(event.operation)));
  assert.equal(result.events.filter(event => event.operation === 'rpc').length, 1);
  assert.equal(result.exit, 1);
  assert.ok(!result.events.some(event => event.status === 'done'));
  assert.equal(result.events.find(event => event.status === 'failed').progress.failed, 1);
});
test('dry-run includes retry candidates without extracting or writing', async () => {
  const row = file('retry');
  const result = await runCli({ rows: [row], existing: [previous(row, 'failed')], args: ['--dry-run'] });
  assert.equal(result.exit, 0, result.errors.join('\n'));
  assert.deepEqual(result.events, []);
  assert.ok(result.logs.some(line => line.includes('to_process=1')));
  assert.deepEqual(result.extracted, []);
});
test('missing run receipt still gives nonzero process exit on extraction failure', async () => {
  const result = await runCli({ runId: null, statuses: { 'sample.pptx': 'failed' } });
  assert.deepEqual(result.extracted, ['sample.pptx']);
  assert.equal(result.exit, 1);
  assert.ok(!result.events.some(event => event.status === 'done'));
});


test('limit applies after resume skipping, even beyond a full completed page', async () => {
  const completed = Array.from({length:1000}, (_, i) => file(`done-${i}`));
  const retry = file('later-retry');
  const result = await runCli({ rows: [...completed, retry],
    existing: [...completed.map(row => previous(row, 'ok')), previous(retry, 'failed')], args: ['--limit=1'] });
  assert.equal(result.exit, 0, result.errors.join('\n'));
  assert.deepEqual(result.extracted, [retry.path]);
  assert.equal(result.events.find(event => event.start).count, 1);
});
test('completed T drive does not hide pending P drive and overall work remains bounded', async () => {
  const completed = Array.from({length:12}, (_, i) => file(`done-${i}`));
  const pending = [{...file('partner-one'),drive:'P'}, {...file('partner-two'),drive:'P'}];
  const result = await runCli({ rows: [...completed, ...pending],
    existing: completed.map(row => previous(row, 'ok')), args: ['--limit=1'] });
  assert.equal(result.exit, 0, result.errors.join('\n'));
  assert.deepEqual(result.extracted, [pending[0].path]);
});
test('restored timestamps, size-only changes and changed drives are retry candidates', async () => {
  const row = file('changed');
  for (const patch of [{modified_at:'2026-09-26T00:00:00Z'}, {size_bytes:101}, {size_bytes:null}, {drive:'P'}, {modified_at:null}]) {
    const result = await runCli({ rows:[row], existing:[{...previous(row,'ok'),...patch}] });
    assert.equal(result.exit,0,result.errors.join('\n'));
    assert.deepEqual(result.extracted,[row.path]);
  }
});


test('physical source changes during extraction cannot publish or overwrite old metadata', async () => {
  const result = await runCli({sourceChanges:true});
  assert.equal(result.exit,1);
  assert.equal(result.events.filter(event => event.operation).length,0);
  assert.equal(result.events.find(event => event.status==='failed').progress.failed,1);
});
test('unreadable physical metadata is not silently replaced with directory metadata', async () => {
  const result = await runCli({statFails:true});
  assert.equal(result.exit,1);
  assert.deepEqual(result.extracted,[]);
  assert.equal(result.events.filter(event => event.operation).length,0);
});
test('failed or skipped extraction plus storage failure counts each file only once', async () => {
  for (const status of ['failed','skipped','empty']) {
    const result = await runCli({statuses:{'sample.pptx':status},insertError:true});
    const progress = result.events.find(event => event.status==='failed').progress;
    assert.equal(progress.failed,1);
    assert.equal(progress.skipped+progress.empty+progress.ok,0);
    assert.equal(result.events.filter(event => event.operation==='rpc').length,1);
  }
});

test('unchanged ok metadata with missing chunks is selected for repair', async () => {
  const row=file('repair');
  const result=await runCli({rows:[row],existing:[previous(row,'ok')],incompletePaths:[row.path]});
  assert.equal(result.exit,0,result.errors.join('\n'));
  assert.deepEqual(result.extracted,[row.path]);
  assert.equal(result.events.find(event=>event.status==='done').progress.ok,1);
});
