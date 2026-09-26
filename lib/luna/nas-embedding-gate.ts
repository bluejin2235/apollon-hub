import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeNasError } from "@/lib/luna/nas-error";

/** Cooperating workers only. No automatic expiry, takeover or paid retry. */
export async function withNasEmbeddingGate<T>(
  admin: SupabaseClient,
  work: (payment: { pending(): void; settled(): void }) => Promise<T>
): Promise<T> {
  const owner = randomUUID();
  const claim = await admin.rpc("nas_embedding_acquire_worker", { p_owner: owner });
  if (claim.error || claim.data !== true) {
    throw new Error(`Embedding worker gate not acquired (${owner}); no paid request started. ` +
      (claim.error ? describeNasError(claim.error) : "Another worker or unresolved prior run holds the gate."));
  }
  let unsettled = false;
  try {
    return await work({ pending() { unsettled = true; }, settled() { unsettled = false; } });
  } finally {
    if (unsettled) {
      console.warn(`Embedding worker gate retained (${owner}): payment/storage outcome requires reconciliation; no automatic takeover.`);
    } else {
      const released = await admin.rpc("nas_embedding_release_worker", { p_owner: owner });
      if (released.error || released.data !== true) {
        throw new Error(`Embedding worker gate release not acknowledged (${owner}); inspect before retrying. ` +
          (released.error ? describeNasError(released.error) : "Invalid release receipt."));
      }
    }
  }
}
