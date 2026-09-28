/** Shared classification policy. Results are metadata inferences, not body verification. */
export const DOCUMENT_ROLE_RULE_VERSION = 'document-role/2';
export type DocumentRole = 'proposal' | 'concept' | 'design' | 'report' | 'planning' | 'operations' | 'review' | 'reference' | 'other';
export type RoleEvidence = {
  role: DocumentRole;
  basis: 'filename' | 'folder' | 'reference-context' | 'unknown';
  evidence: string;
  folder_role: DocumentRole;
  conflict: boolean;
};
function roleHint(text: string): DocumentRole {
  // Purpose cues must precede incidental mentions of design in an interview/receipt.
  if (/인터뷰|interview|영수증|receipt|invoice|견적서|계약서|세금계산서/i.test(text)) return 'other';
  if (/매뉴얼|메뉴얼|manual|cms|운영/i.test(text)) return 'operations';
  if (/제안|proposal|(?:initial|inital)\s*report|pt본/i.test(text)) return 'proposal';
  if (/컨셉|콘셉|concept|기획안|기획연출|ideation/i.test(text)) return 'concept';
  if (/심의|빛관리|의결|조치사항|스팩|스펙|시방/i.test(text)) return 'review';
  if (/디자인|design|설계|시안/i.test(text)) return 'design';
  if (/수행계획|착수|kick.?off|requirement/i.test(text)) return 'planning';
  if (/보고|report|고객사|송부|제출|review|미팅/i.test(text)) return 'report';
  return 'other';
}
export function classifyDocumentRole(relativePath: string): RoleEvidence {
  const parts = relativePath.split(/[/\\]+/).filter(Boolean);
  const leaf = parts.pop() ?? '';
  const folder = parts.join('/');
  const folderRole = roleHint(folder);
  // Reference context remains distinct from the role of the referenced document.
  if (/참고|레퍼런스|benchmark|(?:^|[/ _])ref(?:erence)?(?:[/ _]|$)/i.test([...parts, leaf].join('/'))) {
    return { role: 'reference', basis: 'reference-context', evidence: relativePath, folder_role: folderRole, conflict: false };
  }
  const filenameRole = roleHint(leaf);
  const purpose = /인터뷰|interview|영수증|receipt|invoice|견적서|계약서|세금계산서/i.test(leaf);
  if (filenameRole !== 'other' || purpose) {
    return { role: filenameRole, basis: 'filename', evidence: leaf, folder_role: folderRole,
      conflict: folderRole !== 'other' && folderRole !== filenameRole };
  }
  return { role: folderRole, basis: folderRole === 'other' ? 'unknown' : 'folder', evidence: folder,
    folder_role: folderRole, conflict: false };
}
