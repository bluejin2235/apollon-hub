/** Deduplicates saved source records, not citations in generated prose. */
export function uniqueSourceRecords(cards: unknown, notion: unknown, wiki: unknown) {
  const seen = new Set<string>();
  const groups = [cards, notion, wiki].map((value, group) => {
    if (!Array.isArray(value)) return [];
    return value.filter((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const item = raw as Record<string, unknown>;
      const str = (key: string) => typeof item[key] === "string" ? item[key] as string : "";
      let key = "";
      if (group === 2) {
        // Sections of one wiki document remain separate sources.
        if (str("slug")) key = `wiki:${str("slug")}:${str("section_id")}`;
      } else if (group === 1 || str("type") === "notion") {
        const id = str("id").replace(/-/g, "");
        let urlId = "";
        try {
          const url = new URL(str("url"));
          if (/(^|\.)notion\.(so|com)$/.test(url.hostname)) {
            urlId = url.pathname.replace(/-/g, "").match(/[a-f0-9]{32}$/i)?.[0] ?? "";
          }
        } catch { /* An absent URL does not identify a source. */ }
        const page = /^[a-f0-9]{32}$/i.test(id) ? id : urlId;
        if (page) key = `notion:${page.toLowerCase()}`;
        else if (str("url")) key = `notion-url:${str("url")}`;
      } else if (str("raw_path") && str("drive")) {
        key = `nas:${str("drive").toUpperCase()}:${str("raw_path").replace(/\\/g, "/")}`;
      } else if (str("url")) {
        key = `url:${str("url")}`;
      }
      // Never merge unidentified records just because their titles match.
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  return { cards: groups[0], notion: groups[1], wiki: groups[2], count: groups.reduce((n, group) => n + group.length, 0) };
}
