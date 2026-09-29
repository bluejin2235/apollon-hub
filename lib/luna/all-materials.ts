/** Broad retrieval is independent of project-name parsing and answer wording. */
export function requestsAllMaterials(text: string): boolean {
  return /(?:모두|전부|전체|모든).*(?:찾아|보여|검색)|(?:자료|문서|파일).*모두/.test(text);
}
