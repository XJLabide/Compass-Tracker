export interface MealIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  revision?: number;
  sort_order?: number;
}

export interface MealTemplateInput {
  id: string;
  name: string;
  ingredients: MealIngredient[];
}

export interface MealNutritionTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ScaledMeal {
  servings: number;
  ingredients: MealIngredient[];
  totals: MealNutritionTotals;
}

export interface MealLogSnapshot extends ScaledMeal {
  template_id: string;
  template_name: string;
}

export function scaleMealTemplate(template: MealTemplateInput, servings: number): ScaledMeal {
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new Error("Serving count must be greater than zero");
  }
  if (template.ingredients.length === 0) throw new Error("Add at least one ingredient");
  const ingredients = template.ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: scaleValue(ingredient.quantity, servings),
    calories: scaleValue(ingredient.calories, servings),
    protein_g: scaleValue(ingredient.protein_g, servings),
    carbs_g: scaleValue(ingredient.carbs_g, servings),
    fat_g: scaleValue(ingredient.fat_g, servings),
  }));
  return {
    servings: scaleValue(servings, 1),
    ingredients,
    totals: {
      calories: sum(ingredients, "calories"),
      protein_g: sum(ingredients, "protein_g"),
      carbs_g: sum(ingredients, "carbs_g"),
      fat_g: sum(ingredients, "fat_g"),
    },
  };
}

export function createMealSnapshot(template: MealTemplateInput, servings: number): MealLogSnapshot {
  const scaled = scaleMealTemplate(template, servings);
  return {
    template_id: template.id,
    template_name: template.name,
    servings: scaled.servings,
    ingredients: scaled.ingredients.map((ingredient) => ({
      id: ingredient.id, name: ingredient.name, quantity: ingredient.quantity, unit: ingredient.unit,
      calories: ingredient.calories, protein_g: ingredient.protein_g, carbs_g: ingredient.carbs_g, fat_g: ingredient.fat_g,
    })),
    totals: { ...scaled.totals },
  };
}

function sum(ingredients: MealIngredient[], key: keyof MealNutritionTotals): number {
  return scaleValue(ingredients.reduce((total, ingredient) => total + ingredient[key], 0), 1);
}

function scaleValue(value: number, factor: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Ingredient values must be non-negative numbers");
  return Math.round(value * factor * 100) / 100;
}
