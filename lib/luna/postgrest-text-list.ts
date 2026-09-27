/** PostgREST quoted IN values escape both backslashes and quotes.
 * supabase-js's installed .in() only wraps reserved characters in quotes.
 * https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
 * Pass this to .filter(column, "in", value), NOT to .in().
 */
export function postgrestTextList(values: readonly string[]): string {
  return `(${[...new Set(values)].map(value => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

/** Split combined filter length and row count; a single long path stays intact. */
export function postgrestTextBatches(values: readonly string[]): string[][] {
  const result: string[][] = [];
  for (const value of [...new Set(values)].filter(Boolean)) {
    let batch = result[result.length - 1];
    if (!batch || batch.length === 80 || encodeURIComponent(postgrestTextList([...batch, value])).length > 6000) {
      batch = [];
      result.push(batch);
    }
    batch.push(value);
  }
  return result;
}
