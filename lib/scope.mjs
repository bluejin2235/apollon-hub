// Observed selectable teamspaces in the authenticated Notion source picker.
// This is an explicit test scope, not permission expansion or proof of ACLs.
export const TEAMSPACES = ['아폴론 Working', 'WORKING', 'APOLLOG'];
export const SCOPE = '접근 가능한 팀스페이스 전체';
export function scopeMatches(proof) {
  const names = proof?.selected_teamspaces;
  return Array.isArray(names) && names.length === TEAMSPACES.length
    && new Set(names).size === names.length
    && TEAMSPACES.every(name => names.includes(name))
    && proof.other_sources_off === true;
}
