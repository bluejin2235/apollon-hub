# Durable embedding worker gate

The CLI now acquires one database-backed worker slot after its read-only selection and budget preflight, before creating a run or sending paid requests. Competing workers fail before payment. Selection is still revalidated after acquisition. Dry-run does not acquire a slot or write anything.

The slot does not expire automatically. An owner UUID identifies one process attempt; acquiring twice, even with the same UUID, does not authorize another request. Release deletes only the matching owner. Public and authenticated clients cannot read or call the gate; the table has RLS, and service-only RPCs use invoker rights.

Success releases the slot after the terminal run receipt. Failures before payment also release it. Unknown provider outcomes, storage errors and unacknowledged storage receipts retain it for reconciliation. A process crash retains it too. A lost acquire or release reply may leave a slot held; the CLI does not retry either operation or claim the slot is free. Completion is printed only after release is acknowledged.

## Recovery

Recovery is a deliberate operational action, not a timer or automatic retry. First stop and verify termination of the owning worker. Read its owner UUID, run receipts, provider usage and vector storage outcomes. Establish whether paid work committed and whether unresolved work may be safely attempted again. Only then release that exact owner through the administrative release RPC. Never remove a slot while its owner may still send a request. Keep the reconciliation record with the operational run evidence. No recovery action is executed by this change.

## Verification and rollout

CLI tests cover busy/missing/ambiguous claims, owner-matched release, early failure, uncertain provider or storage responses and unacknowledged release. Isolated SQL tests cover ownership, age, migration replay, RLS and function privileges. Native PostgreSQL CI starts two simultaneous transactions and verifies exactly one acquisition.

Apply the gate migration together with the existing validated-queue and atomic-text migrations before switching the worker. Stop old worker binaries first: this is a cooperating-worker protocol, not a database restriction on every external provider call. Memory-only sample scripts and unrelated callers are outside its scope. It prevents concurrent duplicate calls by this CLI; it is not provider-level exactly-once billing. Automatic takeover, bulk paid execution and operational deployment are not enabled here.

This replaces the earlier documented concurrency limitation for the updated CLI. All operational acceptance and search relevance gates still apply.
