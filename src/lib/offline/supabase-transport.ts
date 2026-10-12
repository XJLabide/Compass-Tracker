import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonValue, MutationTransport } from "./outbox";

interface SyncMutationResponse {
  status: "applied" | "conflict" | "not_found";
  revision?: number;
  server?: { revision: number; payload: JsonValue };
}

export function createSupabaseMutationTransport(
  supabase: SupabaseClient,
): MutationTransport {
  return {
    async apply(mutation) {
      const { data, error } = await supabase.rpc("apply_sync_probe_mutation", {
        p_mutation_id: mutation.id,
        p_record_id: mutation.recordId,
        p_expected_revision: mutation.expectedRevision,
        p_payload: mutation.payload,
      });

      if (error) throw new Error(error.message);
      const result = data as SyncMutationResponse;

      if (result.status === "applied" && result.revision) {
        return { status: "applied", revision: result.revision };
      }
      if (result.status === "conflict" && result.server) {
        return { status: "conflict", server: result.server };
      }
      throw new Error(
        result.status === "not_found"
          ? "The sync record is unavailable for this account."
          : "The sync service returned an unsupported result.",
      );
    },
  };
}
