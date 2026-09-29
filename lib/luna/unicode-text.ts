/** Keep UTF-16 surrogate pairs intact when excerpting source evidence. */
export function sliceUnicode(text: string, start: number, end = text.length): string {
  let from = Math.max(0, start), to = Math.min(text.length, end);
  const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
  const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  if (from > 0 && low(text.charCodeAt(from)) && high(text.charCodeAt(from - 1))) from++;
  if (to > from && high(text.charCodeAt(to - 1)) && low(text.charCodeAt(to))) to--;
  return text.slice(from, to);
}

/** JSON permits escaped lone surrogates, but UTF-8 API parsers can reject them.
 * Preserve valid characters and sanitize only already-damaged input at the boundary. */
export function stringifyUnicodeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'string'
    ? item.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
      part => part.length === 2 ? part : '\uFFFD')
    : item);
}
