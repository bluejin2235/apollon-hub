const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

// Executes the checked-in TypeScript, without a Next server or production credentials.
function loadTs(relative, overrides = {}, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const localRequire = (specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    if (specifier === 'server-only') return {};
    if (specifier.startsWith('@/')) return loadTs(`${specifier.slice(2)}.ts`, overrides, cache);
    throw new Error(`Unmocked dependency: ${specifier}`);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function fakeDb(tables, errors = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = []; let cap = Infinity; let countOnly = false; let one = false;
      let mutation = null; const order = [];
      const builder = {
        select(columns, opts = {}) { countOnly = opts.head === true; calls.push({ table, columns, filters }); return this; },
        eq(key, value) { filters.push([key, 'eq', value]); return this; },
        neq(key, value) { filters.push([key, 'neq', value]); return this; },
        is(key, value) { filters.push([key, 'eq', value]); return this; },
        in(key, value) { filters.push([key, 'in', value]); return this; },
        gt(key, value) { filters.push([key, 'gt', value]); return this; },
        order(key, opts) { order.push([key, opts?.ascending !== false]); return this; },
        limit(n) { cap = n; return this; },
        maybeSingle() { one = true; return this; },
        single() { one = true; return this; },
        upsert(row) { mutation = row; return this; },
        insert(row) { mutation = row; return this; },
        then(resolve, reject) {
          try {
            if (errors[table]) return Promise.resolve({ data: null, error: errors[table] }).then(resolve, reject);
            if (mutation) {
              calls.push({ table, mutation });
              return Promise.resolve({ data: mutation, error: null }).then(resolve, reject);
            }
            let rows = (tables[table] ?? []).filter(row => filters.every(([key, op, value]) =>
              op === 'eq' ? row[key] === value : op === 'neq' ? row[key] !== value :
              op === 'in' ? value.includes(row[key]) : row[key] > value));
            rows = [...rows].sort((a, b) => {
              for (const [key, asc] of order) {
                if (a[key] < b[key]) return asc ? -1 : 1;
                if (a[key] > b[key]) return asc ? 1 : -1;
              }
              return 0;
            }).slice(0, cap);
            return Promise.resolve({ data: countOnly ? null : one ? rows[0] ?? null : rows, count: rows.length, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        }
      };
      return builder;
    }
  };
}
module.exports = { loadTs, fakeDb, root };
