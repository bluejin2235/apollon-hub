/** Shared classification policy. Results are metadata inferences, not body verification. */
export const DOCUMENT_ROLE_RULE_VERSION = 'document-role/4';
export type DocumentRole = 'proposal' | 'concept' | 'design' | 'report' | 'planning' | 'operations' | 'review' | 'reference' | 'other';
export type RoleEvidence = {
  role: DocumentRole;
  basis: 'filename' | 'folder' | 'reference-context' | 'unknown';
  evidence: string;
  folder_role: DocumentRole;
  conflict: boolean;
  purpose: 'administrative' | 'publicity' | null;
};
function nonCorePurpose(text: string): RoleEvidence['purpose'] {
  if (/영수증|receipt|invoice|견적서|견적비교|산출내역|cost[ _-]*breakdown|계약서|세금계산서|발주서|발주내역|정산서|청구서|사업자등록증|통장사본|purchase[ _-]*order/i.test(text)) return 'administrative';
  if (/인터뷰|interview|보도자료|press[ _-]*release|애드버토리얼|기사(?:[\s_.]|샘플|$)/i.test(text)) return 'publicity';
  return null;
}
function roleHint(text: string): DocumentRole {
  // Purpose cues must precede incidental mentions of design in an interview/receipt.
  if (nonCorePurpose(text)) return 'other';
  if (/매뉴얼|메뉴얼|manual|cms|운영/i.test(text)) return 'operations';
  if (/제안|proposal|(?:initial|inital)\s*report|pt본/i.test(text)) return 'proposal';
  if (/컨셉|콘셉|concept|기획안|기획연출|ideation/i.test(text)) return 'concept';
  if (/심의|빛관리|의결|조치사항|스팩|스펙|시방/i.test(text)) return 'review';
  if (/디자인|design|설계|시안/i.test(text)) return 'design';
  if (/수행계획|착수|kick.?off|requirement/i.test(text)) return 'planning';
  if (/보고|report|고객사|송부|제출|review|미팅|진행상황|진척/i.test(text)) return 'report';
  return 'other';
}
export function classifyDocumentRole(relativePath: string): RoleEvidence {
  const parts = relativePath.split(/[/\\]+/).filter(Boolean);
  const leaf = parts.pop() ?? '';
  const folder = parts.join('/');
  const folderRole = roleHint(folder);
  // Reference context remains distinct from the role of the referenced document.
  if (/참고|레퍼런스|benchmark|(?:^|[/ _])ref(?:erence)?(?:[/ _]|$)/i.test([...parts, leaf].join('/'))) {
    return { role: 'reference', basis: 'reference-context', evidence: relativePath, folder_role: folderRole, conflict: false, purpose: nonCorePurpose(leaf) };
  }
  const folderPurpose = nonCorePurpose(folder) ?? (/견적|계약|선금|정산|발주|보증보험/i.test(folder) ? 'administrative' : null);
  const filenameRole = roleHint(leaf);
  const purpose = nonCorePurpose(leaf) ?? folderPurpose;
  if (filenameRole !== 'other' || purpose) {
    return { role: purpose ? 'other' : filenameRole, basis: nonCorePurpose(leaf) ? 'filename' : folderPurpose ? 'folder' : 'filename', evidence: folderPurpose ? folder : leaf, folder_role: folderRole,
      conflict: folderRole !== 'other' && folderRole !== filenameRole, purpose };
  }
  return { role: folderRole, basis: folderRole === 'other' ? 'unknown' : 'folder', evidence: folder,
    folder_role: folderRole, conflict: false, purpose: nonCorePurpose(folder) };
}
