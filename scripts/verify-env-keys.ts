/**
 * 환경변수 별칭
 *   npx tsx scripts/verify-env-keys.ts
 */
import {
  envAny,
  missingEnvGroups,
  ENV_ALIAS_GROUPS
} from "../lib/luna/env-keys";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(ENV_ALIAS_GROUPS.some((g) => g.id === "tavily"), "tavily group");
assert(
  ENV_ALIAS_GROUPS.find((g) => g.id === "artificial_analysis")!.names.includes(
    "ARTIFICIAL_ANALYSIS_API_KEY"
  ),
  "aa alias"
);
assert(
  ENV_ALIAS_GROUPS.find((g) => g.id === "anthropic")!.names.includes(
    "ANTHROPIC_API_KEY"
  ),
  "anthropic alias"
);

const prevAa = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
const prevLuna = process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY;
delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
delete process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY;
assert(
  envAny(["LUNA_ARTIFICIAL_ANALYSIS_API_KEY", "ARTIFICIAL_ANALYSIS_API_KEY"]) ===
    "",
  "empty"
);
process.env.ARTIFICIAL_ANALYSIS_API_KEY = "x";
assert(
  envAny(["LUNA_ARTIFICIAL_ANALYSIS_API_KEY", "ARTIFICIAL_ANALYSIS_API_KEY"]) ===
    "x",
  "alias hits"
);
if (prevAa === undefined) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
else process.env.ARTIFICIAL_ANALYSIS_API_KEY = prevAa;
if (prevLuna === undefined) delete process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY;
else process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY = prevLuna;

const missing = missingEnvGroups();
assert(Array.isArray(missing), "missing list");

console.log("OK env-keys", "groups=", ENV_ALIAS_GROUPS.length);
