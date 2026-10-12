import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueuedMutation } from "./outbox";
import { createSupabaseMutationTransport } from "./supabase-transport";

describe("createSupabaseMutationTransport", () => {
  it("routes workspace writes through their domain RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "applied", revision: 2 }, error: null });
    const transport = createSupabaseMutationTransport({ rpc } as unknown as SupabaseClient);
    const entities: QueuedMutation[] = [
      mutation("calendar_event", { title: "Planning" }),
      mutation("project_task_link", { project_id: "project", task_id: "task", stage_id: "stage" }),
      mutation("goal_update", { goal_id: "goal", value: 2, unit: "books", source: "Manual" }),
    ];

    for (const row of entities) await expect(transport.apply(row)).resolves.toEqual({ status: "applied", revision: 2 });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "apply_calendar_mutation",
      "apply_project_mutation",
      "apply_goal_mutation",
    ]);
  });
});

function mutation(entityType: NonNullable<QueuedMutation["entityType"]>, payload: QueuedMutation["payload"]): QueuedMutation {
  return {
    id: `mutation-${entityType}`,
    entityType,
    recordId: `record-${entityType}`,
    expectedRevision: 1,
    payload,
    createdAt: 1,
    status: "pending",
  };
}
