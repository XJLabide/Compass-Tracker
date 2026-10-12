import { describe, expect, it } from "vitest";
import type { QueuedMutation } from "@/lib/offline/outbox";
import { projectLocalNutritionMutations } from "./projection";
import { emptyNutritionSnapshot } from "./types";

describe("offline nutrition projection", () => {
  it("keeps an optional daily check-in absent while projecting a meal snapshot", () => {
    const mutation: QueuedMutation = {
      id: "mutation-1", recordId: "meal-1", entityType: "meal_log", expectedRevision: 0,
      payload: {
        local_date: "2026-10-14", logged_at: "2026-10-14T07:30:00Z", meal_type: "breakfast", active: true,
        snapshot: {
          template_id: "template-1", template_name: "Oats", servings: 2,
          ingredients: [{ id: "oats", name: "Oats", quantity: 80, unit: "g", calories: 300, protein_g: 10, carbs_g: 54, fat_g: 6 }],
          totals: { calories: 300, protein_g: 10, carbs_g: 54, fat_g: 6 },
        },
      },
      createdAt: 1, status: "pending",
    };
    const projected = projectLocalNutritionMutations(emptyNutritionSnapshot, [mutation]);

    expect(projected.mealLogs[0].snapshot.ingredients[0]).toMatchObject({ name: "Oats", quantity: 80, calories: 300 });
    expect(projected.checkins).toEqual([]);
    expect(emptyNutritionSnapshot.mealLogs).toEqual([]);
  });

  it("removes an archived ingredient from the projected template without changing meal snapshots", () => {
    const projected = projectLocalNutritionMutations(emptyNutritionSnapshot, [
      {
        id: "template-create", recordId: "template-1", entityType: "meal_template", expectedRevision: 0,
        payload: { name: "Oats", meal_type: "breakfast", active: true }, createdAt: 1, status: "pending",
      },
      {
        id: "item-create", recordId: "item-1", entityType: "meal_template_item", expectedRevision: 0,
        payload: { template_id: "template-1", name: "Oats", quantity: 40, unit: "g", calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 }, createdAt: 2, status: "pending",
      },
      {
        id: "item-archive", recordId: "item-1", entityType: "meal_template_item_archive", expectedRevision: 1,
        payload: {}, createdAt: 3, status: "pending",
      },
    ]);

    expect(projected.templates[0].ingredients).toEqual([]);
  });
});
