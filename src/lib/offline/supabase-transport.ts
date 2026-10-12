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
        : mutation.entityType === "calendar_event"
          ? await supabase.rpc("apply_calendar_mutation", {
              p_mutation_id: mutation.id,
              p_event_id: mutation.recordId,
              p_expected_revision: mutation.expectedRevision,
              p_payload: mutation.payload,
            })
          : isProjectMutation(mutation.entityType)
            ? await supabase.rpc("apply_project_mutation", {
                p_mutation_id: mutation.id,
                p_entity_type: mutation.entityType,
                p_entity_id: mutation.recordId,
                p_expected_revision: mutation.expectedRevision,
                p_payload: mutation.payload,
              })
              : isGoalMutation(mutation.entityType)
              ? await supabase.rpc("apply_goal_mutation", {
                  p_mutation_id: mutation.id,
                  p_entity_type: mutation.entityType,
                  p_entity_id: mutation.recordId,
                  p_expected_revision: mutation.expectedRevision,
                  p_payload: mutation.payload,
                })
              : isFitnessMutation(mutation.entityType)
                ? await supabase.rpc("apply_fitness_mutation", {
                    p_mutation_id: mutation.id,
                    p_entity_type: mutation.entityType,
                    p_entity_id: mutation.recordId,
                    p_expected_revision: mutation.expectedRevision,
                    p_payload: mutation.payload,
                  })
                : mutation.entityType === "meal_template_item_archive"
                  ? await supabase.rpc("archive_meal_template_item", {
                      p_mutation_id: mutation.id,
                      p_item_id: mutation.recordId,
                      p_expected_revision: mutation.expectedRevision,
                    })
                : isNutritionMutation(mutation.entityType)
                  ? await supabase.rpc("apply_nutrition_mutation", {
                      p_mutation_id: mutation.id,
                      p_entity_type: mutation.entityType,
                      p_entity_id: mutation.recordId,
                      p_expected_revision: mutation.expectedRevision,
                      p_payload: mutation.payload,
                    })
                  : isFinanceMutation(mutation.entityType)
                    ? await supabase.rpc("apply_finance_mutation", {
                        p_mutation_id: mutation.id,
                        p_entity_type: mutation.entityType,
                        p_entity_id: mutation.recordId,
                        p_expected_revision: mutation.expectedRevision,
                        p_payload: mutation.payload,
                      })
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

function isProjectMutation(entityType: QueuedMutation["entityType"]): entityType is "project" | "project_stage" | "project_task_link" {
  return entityType === "project" || entityType === "project_stage" || entityType === "project_task_link";
}

function isGoalMutation(entityType: QueuedMutation["entityType"]): entityType is "life_area" | "goal" | "goal_update" | "goal_project_link" {
  return entityType === "life_area" || entityType === "goal" || entityType === "goal_update" || entityType === "goal_project_link";
}

function isFitnessMutation(entityType: QueuedMutation["entityType"]): entityType is
  | "fitness_exercise"
  | "strength_program"
  | "strength_program_day"
  | "strength_program_exercise"
  | "strength_override"
  | "workout_log"
  | "fitness_activity_log" {
  return entityType === "fitness_exercise"
    || entityType === "strength_program"
    || entityType === "strength_program_day"
    || entityType === "strength_program_exercise"
    || entityType === "strength_override"
    || entityType === "workout_log"
    || entityType === "fitness_activity_log";
}

function isNutritionMutation(entityType: QueuedMutation["entityType"]): entityType is
  | "nutrition_target"
  | "meal_template"
  | "meal_template_item"
  | "meal_template_item_archive"
  | "meal_log"
  | "nutrition_checkin" {
  return entityType === "nutrition_target"
    || entityType === "meal_template"
    || entityType === "meal_template_item"
    || entityType === "meal_template_item_archive"
    || entityType === "meal_log"
    || entityType === "nutrition_checkin";
}

function isFinanceMutation(entityType: QueuedMutation["entityType"]): entityType is
  | "finance_account"
  | "finance_transaction"
  | "finance_budget"
  | "finance_recurring_charge"
  | "finance_position"
  | "finance_valuation"
  | "finance_fx_rate"
  | "finance_conversion" {
  return entityType === "finance_account"
    || entityType === "finance_transaction"
    || entityType === "finance_budget"
    || entityType === "finance_recurring_charge"
    || entityType === "finance_position"
    || entityType === "finance_valuation"
    || entityType === "finance_fx_rate"
    || entityType === "finance_conversion";
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
