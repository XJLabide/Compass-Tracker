import type { SupabaseClient } from "@supabase/supabase-js";
import type { JsonValue, MutationTransport, QueuedMutation } from "./outbox";

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
      const result = mutation.entityType === "end_day"
        ? await applyDayEnd(supabase, mutation)
        : mutation.entityType
          ? await supabase.rpc("apply_daily_mutation", {
              p_mutation_id: mutation.id,
              p_entity_type: mutation.entityType,
              p_entity_id: mutation.recordId,
              p_expected_revision: mutation.expectedRevision,
              p_operation: mutation.operation ?? "upsert",
              p_payload: mutation.payload,
            })
          : await supabase.rpc("apply_sync_probe_mutation", {
              p_mutation_id: mutation.id,
              p_record_id: mutation.recordId,
              p_expected_revision: mutation.expectedRevision,
              p_payload: mutation.payload,
            });

      if (result.error) throw new Error(result.error.message);
      const response = result.data as SyncMutationResponse;

      if (response.status === "applied" && response.revision) {
        return { status: "applied", revision: response.revision };
      }
      if (response.status === "conflict" && response.server) {
        return { status: "conflict", server: response.server };
      }
      throw new Error(
        response.status === "not_found"
          ? "The sync record is unavailable for this account."
          : "The sync service returned an unsupported result.",
      );
    },
  };
}

async function applyDayEnd(supabase: SupabaseClient, mutation: QueuedMutation) {
  const payload = mutation.payload as {
    outcomes?: Array<{ priority_id: string; outcome: string }>;
    reflection?: string | null;
    carry_forward?: Array<{ source_priority_id: string; new_priority_id: string }>;
  };
  return supabase.rpc("finish_daily_plan", {
    p_mutation_id: mutation.id,
    p_plan_id: mutation.recordId,
    p_expected_revision: mutation.expectedRevision,
    p_outcomes: payload.outcomes ?? [],
    p_reflection: payload.reflection ?? null,
    p_carry_forward: payload.carry_forward ?? [],
  });
}
