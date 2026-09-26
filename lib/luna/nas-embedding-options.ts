/** Bounded defaults: inspection is read-only unless execution is explicit. */
export function parseNasEmbeddingArgs(argv: string[]) {
  let limit = 500;
  let batchSize = 100;
  let kind: "full" | "incremental" = "incremental";
  let apply = false;
  let maxCostUsd = 1;
  for (const arg of argv) {
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--full") { kind = "full"; continue; }
    if (arg.startsWith("--max-cost-usd=")) {
      const raw = arg.slice("--max-cost-usd=".length);
      const n = Number(raw);
      if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(n) || n <= 0 || n > 1) {
        throw new Error("max-cost-usd must be greater than 0 and at most 1");
      }
      maxCostUsd = n;
      continue;
    }
    const match = arg.match(/^--(limit|batch)=(\d+)$/);
    if (!match) throw new Error(`Unknown or invalid argument: ${arg}`);
    const n = Number(match[2]);
    const max = match[1] === "limit" ? 5000 : 100;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      throw new Error(`${match[1]} must be between 1 and ${max}`);
    }
    if (match[1] === "limit") limit = n; else batchSize = n;
  }
  return { limit, batchSize, kind, apply, maxCostUsd };
}
