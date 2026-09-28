import { createHash } from 'node:crypto';
import { classifyDocumentRole, DOCUMENT_ROLE_RULE_VERSION } from '@/lib/luna/document-role';
import { normalizeNasPath, projectPathRoot, sameDrive, underNasPath } from '@/lib/luna/nas-priority';
import { seasonsIn } from '@/lib/luna/season-scope';

export const PROFILE_NAMESPACE = 'secondary_document_profile_v1';
export const PROFILE_RULE_VERSION = 'secondary-document-profile/1';
export type PrimaryNasSnapshot = {
  id: string | number; drive: string; path: string; type: string;
  size_bytes: number | null; modified_at: string | null; scan_batch: string | null;
  importance: number | null; marked_reason: string | null;
};
export type PrimaryMarkSnapshot = { id: string | number; drive: string; path: string; note: string | null; created_at: string };
export type ExistingMembership = {
  id: string; from_type: string; from_id: string; to_type: string; to_id: string;
  kind: string; status: string; evidence: Record<string, unknown> | null;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fullKey = (drive: string, path: string) => drive.replace(':', '').toUpperCase() + ':' + normalizeNasPath(path);
function matchingMarks(source: PrimaryNasSnapshot, marks: PrimaryMarkSnapshot[]) {
  return marks.filter(m => sameDrive(source.drive, m.drive) && underNasPath(source.path, m.path))
    .map(m => ({ id: String(m.id), drive: m.drive, path: m.path, note: m.note, created_at: m.created_at }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function sourceSnapshot(source: PrimaryNasSnapshot) {
  return { table: 'nas_directory' as const, id: String(source.id), drive: source.drive, path: source.path,
    type: source.type, size_bytes: source.size_bytes, modified_at: source.modified_at,
    scan_batch: source.scan_batch, importance: source.importance, marked_reason: source.marked_reason };
}
const policy = { profile: PROFILE_RULE_VERSION, role: DOCUMENT_ROLE_RULE_VERSION };
/** A layer-2 metadata candidate. Neither an active legacy edge nor a filename proves its claims. */
export function buildSecondaryDocumentProfile(
  link: ExistingMembership, source: PrimaryNasSnapshot, marks: PrimaryMarkSnapshot[],
  generatorCommit: string, generatedAt: string
) {
  if (!/^[0-9a-f]{40}$/.test(generatorCommit) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('Missing generator provenance');
  if (!source.id || !source.scan_batch || !/^[a-z]:?$/i.test(source.drive) || !source.path || source.type !== 'file') throw new Error('Incomplete primary snapshot');
  const drive = link.from_id.match(/^([a-z]):/i)?.[1];
  const root = projectPathRoot(source.path);
  if (link.from_type !== 'nas_path' || link.to_type !== 'project' || link.kind !== 'belongs' || link.status !== 'active' ||
    !drive || fullKey(drive, link.from_id) !== fullKey(source.drive, source.path) || !root) throw new Error('Membership/source identity mismatch');
  const rawTarget = link.evidence?.to_path;
  const targetDrive = typeof rawTarget === 'string' ? rawTarget.match(/^([a-z]):/i)?.[1] : null;
  if (!targetDrive || fullKey(targetDrive, rawTarget as string) !== fullKey(source.drive, root) ||
    normalizeNasPath(root).split('/').pop() !== link.to_id.toLowerCase()) throw new Error('Project root requires reconciliation');
  const relative = source.path.replace(/^[a-z]:[/\\]+/i, '').slice(root.length);
  const role = classifyDocumentRole(relative);
  const seasonLabels = seasonsIn(source.path);
  const manualMarks = matchingMarks(source, marks);
  const inputs = { primary: sourceSnapshot(source), manual_marks: manualMarks };
  const claims = {
    // A drive/year/root identity, not a cross-phase canonical business project ID.
    project_folder: { key: fullKey(source.drive, root), label: link.to_id, basis: 'path-membership' as const },
    document_role: { ...role, state: role.basis === 'unknown' ? 'unknown' as const : 'inferred' as const },
    season: { value: seasonLabels.length === 1 ? seasonLabels[0] : null, labels: seasonLabels,
      state: seasonLabels.length > 1 ? 'conflict' : seasonLabels.length === 1 ? 'inferred' : 'unknown', basis: 'explicit-path-label-only' },
    importance: { manual_mark_ids: manualMarks.map(m => m.id), scanner: (source.importance ?? 0) > 0,
      inferred: false, basis: manualMarks.length ? 'manual-path-ancestry' : (source.importance ?? 0) > 0 ? 'scanner-field' : 'none' },
  };
  const conflicts = [...(role.conflict ? ['filename-folder-role'] : []), ...(seasonLabels.length > 1 ? ['multiple-season-labels'] : [])];
  const payload = { layer: 2 as const, schema_version: 1 as const, policy, generator_commit: generatorCommit,
    inputs, claims, conflicts, review_state: 'candidate' as const, verified_at: null,
    limitations: ['metadata-only', 'body-not-reviewed', 'approval-not-inferred', 'project-phases-not-unified'] };
  return { ...payload, revision_key: digest(payload), generated_at: generatedAt };
}
export type SecondaryDocumentProfile = ReturnType<typeof buildSecondaryDocumentProfile>;

/** Missing source/marks mean unavailable, never proof of deletion. A rescan is conservative staleness. */
export function profileFreshness(profile: SecondaryDocumentProfile, source: PrimaryNasSnapshot | null,
  marks: PrimaryMarkSnapshot[] | null): 'current' | 'stale' | 'unavailable' {
  if (!source || !marks) return 'unavailable';
  if (profile.schema_version !== 1 || profile.layer !== 2 || digest(profile.policy) !== digest(policy)) return 'stale';
  return digest(profile.inputs) === digest({ primary: sourceSnapshot(source), manual_marks: matchingMarks(source, marks) }) ? 'current' : 'stale';
}

/** Layer 3 has its own identity and exact layer-2 dependencies; never store it as a primary/role claim. */
export type TertiaryInsight = {
  layer: 3; id: string; revision_key: string; generated_at: string; generator_commit: string; policy_version: string;
  inputs: Array<{ layer: 2; link_id: string; profile_namespace: typeof PROFILE_NAMESPACE; revision_key: string }>;
  kind: 'summary' | 'comparison' | 'recommendation';
  content: string; review_state: 'candidate' | 'verified' | 'conflict';
};
