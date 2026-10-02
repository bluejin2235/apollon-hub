/** Bound each parallel source; a failed/slow source must not hold every result forever. */
export async function runSearchTask<T>(
  signal: AbortSignal, timeoutMs: number, task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted();
  const local = new AbortController();
  const combined = AbortSignal.any([signal, local.signal]);
  const timer = setTimeout(() => local.abort(new DOMException("Search timed out", "TimeoutError")), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      task(combined),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason);
        combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) combined.removeEventListener("abort", onAbort);
  }
}
