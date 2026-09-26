/** Preserve useful fields from thrown objects without serializing request bodies,
 * headers, environment or arbitrary source content. Output is bounded diagnostic text.
 */
export function describeNasError(value: unknown, limit = 500): string {
  const seen = new Set<object>();
  const clean = (text: string) => text
    .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]");
  const inspect = (input: unknown, depth: number): unknown => {
    if (typeof input === "string") return clean(input).slice(0, limit);
    if (typeof input === "number" || typeof input === "boolean" || input == null) return input;
    if (typeof input !== "object") return typeof input;
    if (seen.has(input)) return "[circular]";
    if (depth > 2) return "[depth limit]";
    seen.add(input);
    const result: Record<string, unknown> = {};
    for (const key of ["name", "code", "errno", "status", "message", "cause", "errors"]) {
      let field: unknown;
      try { field = (input as Record<string, unknown>)[key]; } catch { continue; }
      if (field === undefined) continue;
      if (key === "errors" && Array.isArray(field)) result.errors = field.slice(0, 3).map(item => inspect(item, depth + 1));
      else if (key === "cause") result.cause = inspect(field, depth + 1);
      else if (["string", "number", "boolean"].includes(typeof field)) result[key] = inspect(field, depth + 1);
    }
    return Object.keys(result).length ? result : { type: "object", diagnostic: "no standard error fields" };
  };
  try {
    const safe = inspect(value, 0);
    const text = typeof safe === "string" ? safe : JSON.stringify(safe) ?? String(value);
    return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + "…" : text;
  } catch {
    return "uninspectable thrown value";
  }
}

export class NasExtractionLimitError extends Error {
  readonly code = "NAS_EXTRACTION_LIMIT";
  constructor(reason: string) { super(reason); this.name = "NasExtractionLimitError"; }
}
