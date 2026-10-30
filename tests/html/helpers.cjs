/**
 * 정리기 회귀 테스트 공통.
 * DOM 경로는 Playwright Chrome 의 DOMParser.
 * 정규식 경로는 Node 에서 DOMParser 없이 같은 함수를 부른다.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { chromium } = require("playwright");
const { ALL, FILES, FN, KINDS } = require("./cases.cjs");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures");
const COMPARE_FILE = path.join(FIXTURES, "compare.json");

function transpile(relative) {
  const filename = path.resolve(ROOT, relative);
  return ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

function loadTs(relative, cache = new Map()) {
  const filename = path.resolve(ROOT, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const output = transpile(relative);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return loadTs(`${specifier.slice(2)}.ts`, cache);
    throw new Error(`Unmocked dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

const nodeModules = {
  insight: loadTs(FILES.insight),
  lead: loadTs(FILES.lead),
  issue: loadTs(FILES.issue)
};

function sanitizeRegex(kind, html) {
  if (typeof globalThis.DOMParser !== "undefined") {
    throw new Error("정규식 경로인데 DOMParser 가 있습니다");
  }
  return nodeModules[kind][FN[kind]](html);
}

let browser;
let page;
let startPromise;

async function launchChrome() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "chrome", headless: true });
  }
}

async function startDom() {
  if (!startPromise) {
    startPromise = (async () => {
      browser = await launchChrome();
      page = await browser.newPage();
      const sources = {};
      const sourceFiles = [...new Set([...Object.values(FILES), "lib/website/rich-html.ts"])];
      for (const file of sourceFiles) sources[file] = transpile(file);
      await page.evaluate((payload) => {
        const cache = Object.create(null);
        function load(file) {
          if (cache[file]) return cache[file].exports;
          const module = { exports: {} };
          cache[file] = module;
          const req = (spec) => {
            if (spec === "server-only") return {};
            if (spec.startsWith("@/")) return load(`${spec.slice(2)}.ts`);
            throw new Error(`Unmocked dependency: ${spec}`);
          };
          const fn = new Function("require", "module", "exports", payload.sources[file]);
          fn(req, module, module.exports);
          return module.exports;
        }
        const insight = load("lib/website/insight-html.ts");
        const lead = load("lib/website/lead-html.ts");
        const issue = load("lib/issues/html.ts");
        globalThis.__htmlSanitizers = {
          insight: insight.sanitizeInsightHtml,
          lead: lead.sanitizeLeadHtml,
          issue: issue.sanitizeIssueHtml,
          hasDomParser: typeof DOMParser !== "undefined"
        };
      }, { sources });
      const ok = await page.evaluate(() => globalThis.__htmlSanitizers.hasDomParser);
      if (!ok) throw new Error("브라우저에 DOMParser 가 없습니다");
    })();
  }
  await startPromise;
}

async function stopDom() {
  if (browser) await browser.close();
  browser = undefined;
  page = undefined;
  startPromise = undefined;
}

async function sanitizeDom(kind, html) {
  if (!page) throw new Error("startDom() 을 먼저 부르세요");
  return page.evaluate(
    ({ kind, html }) => globalThis.__htmlSanitizers[kind](html),
    { kind, html }
  );
}

function readCompare() {
  return JSON.parse(fs.readFileSync(COMPARE_FILE, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function collectCompare() {
  await startDom();
  const table = {};
  for (const item of ALL) {
    table[item.id] = { input: item.html };
    for (const kind of KINDS) {
      table[item.id][kind] = {
        dom: await sanitizeDom(kind, item.html),
        regex: sanitizeRegex(kind, item.html)
      };
    }
  }
  return table;
}

async function updateCompare() {
  const table = await collectCompare();
  writeJson(COMPARE_FILE, table);
  return table;
}

function registerSanitizerTests(kind) {
  const { after, before, test } = require("node:test");
  const assert = require("node:assert/strict");
  const { ALL, EXISTING } = require("./cases.cjs");

  before(async () => {
    await startDom();
  });
  after(async () => {
    await stopDom();
  });

  test(`${kind} DOM 경로가 기준값과 같다`, async () => {
    const golden = readCompare();
    for (const item of ALL) {
      assert.equal(await sanitizeDom(kind, item.html), golden[item.id][kind].dom, item.id);
    }
  });

  test(`${kind} 정규식 경로가 기준값과 같다`, () => {
    const golden = readCompare();
    for (const item of ALL) {
      assert.equal(sanitizeRegex(kind, item.html), golden[item.id][kind].regex, item.id);
    }
  });

  test(`${kind} 기존 글 DOM 출력이 기준값과 같다`, async () => {
    const golden = readCompare();
    for (const item of EXISTING) {
      assert.equal(await sanitizeDom(kind, item.html), golden[item.id][kind].dom, item.id);
    }
  });
}

module.exports = {
  COMPARE_FILE,
  collectCompare,
  readCompare,
  registerSanitizerTests,
  sanitizeDom,
  sanitizeRegex,
  startDom,
  stopDom,
  updateCompare
};

if (require.main === module) {
  updateCompare()
    .then(async (table) => {
      console.log(`wrote ${COMPARE_FILE} (${Object.keys(table).length} cases)`);
      await stopDom();
    })
    .catch(async (error) => {
      await stopDom().catch(() => {});
      console.error(error);
      process.exit(1);
    });
}
