export type AltSuggestKind = "work" | "insight";

export type AltSuggestContext = {
  kind: AltSuggestKind;
  titleKo?: string | null;
  titleEn?: string | null;
  category?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  sectionTitle?: string | null;
  fileName?: string | null;
};

export type AltSuggestResult = { ko: string; en: string };
