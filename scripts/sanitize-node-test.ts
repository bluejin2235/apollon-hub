import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeInsightHtml } from "../lib/website/insight-html";

const raw = "<p><b>title</b></p><p></p>";
const out = {
  hasDomParser: typeof DOMParser !== "undefined",
  raw,
  sanitized: sanitizeInsightHtml(raw)
};
writeFileSync(resolve("tmp", "sanitize-node-test.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
