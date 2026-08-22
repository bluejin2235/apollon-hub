import assert from "node:assert/strict";
import { formatNasFolderPath } from "../lib/luna/nas-path";
import {
  DEFAULT_NAS_PATH_SETTINGS,
  type NasPathSettings
} from "../lib/luna/nas-path-settings";

const SAMPLE =
  "01 사업개발\\2025\\250213 성수동2가 316-52 미디어조형물\\02 Document";

function office(): NasPathSettings {
  return { ...DEFAULT_NAS_PATH_SETTINGS, mode: "office" };
}

function unc(): NasPathSettings {
  return { ...DEFAULT_NAS_PATH_SETTINGS, mode: "unc" };
}

function custom(prefixT: string, prefixP: string): NasPathSettings {
  return { mode: "custom", prefixT, prefixP };
}

const officePath = formatNasFolderPath("T", SAMPLE, office(), false).replace(
  /\\+$/,
  ""
);
assert.ok(
  officePath.startsWith("T:\\"),
  `office T path should start with T:\\ — got ${officePath}`
);

const uncPath = formatNasFolderPath("T", SAMPLE, unc(), false).replace(/\\+$/, "");
assert.ok(
  uncPath.startsWith("\\\\aiw\\work\\"),
  `unc T path should start with \\\\aiw\\work\\ — got ${uncPath}`
);
assert.ok(uncPath.includes(SAMPLE), "unc path must include raw nas_directory.path");

const customPath = formatNasFolderPath(
  "T",
  SAMPLE,
  custom("D:\\MyMount\\", "Q:\\P\\"),
  false
).replace(/\\+$/, "");
assert.ok(
  customPath.startsWith("D:\\MyMount\\"),
  `custom path should use user prefix — got ${customPath}`
);

const changed = formatNasFolderPath(
  "T",
  SAMPLE,
  custom("Z:\\Work\\", "Z:\\Partners\\"),
  false
);
const baseline = formatNasFolderPath("T", SAMPLE, office(), false);
assert.notEqual(changed, baseline, "changing prefix should change displayed path");

console.log("verify-nas-path-settings: OK");
console.log("  office:", officePath.slice(0, 60) + "...");
console.log("  unc:", uncPath.slice(0, 60) + "...");
console.log("  custom:", customPath.slice(0, 60) + "...");
