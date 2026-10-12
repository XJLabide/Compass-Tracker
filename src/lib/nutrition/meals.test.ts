import { describe, expect, it } from "vitest";
import { createMealSnapshot, scaleMealTemplate } from "./meals";

const template = () => ({
  id: "template-1",
  name: "Oats and yogurt",
  ingredients: [
    { id: "item-1", name: "Oats", quantity: 40, unit: "g", calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
    { id: "item-2", name: "Greek yogurt", quantity: 100, unit: "g", calories: 90, protein_g: 10, carbs_g: 4, fat_g: 2 },
  ],
});

describe("meal template scaling and logged snapshots", () => {
  it("scales ingredient quantities and nutrition consistently", () => {
    expect(scaleMealTemplate(template(), 1.5)).toEqual({
      servings: 1.5,
      ingredients: [
        { id: "item-1", name: "Oats", quantity: 60, unit: "g", calories: 225, protein_g: 7.5, carbs_g: 40.5, fat_g: 4.5 },
        { id: "item-2", name: "Greek yogurt", quantity: 150, unit: "g", calories: 135, protein_g: 15, carbs_g: 6, fat_g: 3 },
      ],
      totals: { calories: 360, protein_g: 22.5, carbs_g: 46.5, fat_g: 7.5 },
    });
  });

  it("copies the source template into a meal log snapshot", () => {
    const source = template();
    const snapshot = createMealSnapshot(source, 2);
    source.name = "Renamed breakfast";
    source.ingredients[0].name = "Different oats";
    source.ingredients[0].calories = 20;

    expect(snapshot.template_name).toBe("Oats and yogurt");
    expect(snapshot.ingredients[0]).toMatchObject({ name: "Oats", calories: 300, quantity: 80 });
    expect(snapshot.totals.calories).toBe(480);
  });

  it("rejects empty ingredients and non-positive serving counts", () => {
    expect(() => scaleMealTemplate(template(), 0)).toThrow("Serving count must be greater than zero");
    expect(() => scaleMealTemplate({ id: "empty", name: "Empty", ingredients: [] }, 1)).toThrow("Add at least one ingredient");
  });
});
