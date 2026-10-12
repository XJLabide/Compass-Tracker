"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useWorkspace } from "@/app/app-workspace";
import { PageHeader } from "@/app/daily-components";
import { HealthSheet } from "@/app/health-sheet";
import { localToday } from "@/lib/daily/repository";
import { listMutations, type JsonValue } from "@/lib/offline/outbox";
import { projectLocalNutritionMutations } from "@/lib/nutrition/projection";
import { createMealSnapshot } from "@/lib/nutrition/meals";
import type { MealTemplate, NutritionCheckin, NutritionSnapshot } from "@/lib/nutrition/types";
import { emptyNutritionSnapshot } from "@/lib/nutrition/types";
import { loadNutritionSnapshot } from "@/lib/planning/repository";
import { createClient } from "@/lib/supabase/client";

type NutritionForm = "target" | "template" | "checkin" | null;

export default function NutritionPage() {
  const { ownerId, profile, database, refreshKey, queueMutation, online } = useWorkspace();
  const today = localToday(profile.timezone);
  const [snapshot, setSnapshot] = useState<NutritionSnapshot>(emptyNutritionSnapshot);
  const [form, setForm] = useState<NutritionForm>(null);
  const [editTemplate, setEditTemplate] = useState<MealTemplate | null>(null);
  const [editTarget, setEditTarget] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!database) return;
    let active = true;
    async function load() {
      try {
        const [loaded, mutations] = await Promise.all([
          loadNutritionSnapshot(createClient(), database!, today),
          listMutations(database!),
        ]);
        if (active) {
          setSnapshot(projectLocalNutritionMutations(loaded.snapshot, mutations));
          setOffline(loaded.offline);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Nutrition data could not be loaded.");
      }
    }
    void load();
    return () => { active = false; };
  }, [database, ownerId, refreshKey, today]);

  const todayMeals = useMemo(() => snapshot.mealLogs.filter(({ local_date, active }) => local_date === today && active), [snapshot.mealLogs, today]);
  const todayTotals = useMemo(() => todayMeals.reduce((totals, meal) => ({
    calories: totals.calories + meal.snapshot.totals.calories,
    protein_g: totals.protein_g + meal.snapshot.totals.protein_g,
    carbs_g: totals.carbs_g + meal.snapshot.totals.carbs_g,
    fat_g: totals.fat_g + meal.snapshot.totals.fat_g,
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), [todayMeals]);

  async function submitTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const values = ["target-calories", "target-protein", "target-carbs", "target-fat"].map((key) => Number(data.get(key)));
    if (!Number.isInteger(values[0]) || values[0] <= 0 || values.slice(1).some((value) => !Number.isFinite(value) || value < 0)) { setError("Use a whole calorie target above zero and macros at zero or higher."); return; }
    const target = snapshot.target;
    try {
      await queueMutation({ entityType: "nutrition_target", recordId: target?.id ?? crypto.randomUUID(), expectedRevision: target?.revision ?? 0,
        payload: { calories: values[0], protein_g: values[1], carbs_g: values[2], fat_g: values[3], effective_from: String(data.get("target-date") || today) } });
      setForm(null); setEditTarget(false); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Nutrition targets could not be saved."); }
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>, ingredients: MealTemplate["ingredients"], removedIds: string[]) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const name = String(data.get("template-name") ?? "").trim();
    if (!name) { setError("Add a meal name."); return; }
    if (!ingredients.length || ingredients.some(({ name: ingredientName }) => !ingredientName.trim())) { setError("Add a name for every ingredient."); return; }
    if (ingredients.some(({ quantity, calories, protein_g, carbs_g, fat_g, unit }) => !unit.trim() || !Number.isFinite(quantity) || quantity <= 0 || [calories, protein_g, carbs_g, fat_g].some((value) => !Number.isFinite(value) || value < 0))) {
      setError("Ingredient amounts must be positive, and nutrition values must be zero or higher."); return;
    }
    const current = editTemplate;
    try {
      const templateId = current?.id ?? crypto.randomUUID();
      await queueMutation({ entityType: "meal_template", recordId: templateId, expectedRevision: current?.revision ?? 0,
        payload: { name, meal_type: String(data.get("template-type") || "snack"), notes: optional(data.get("template-notes")), active: true } });
      for (const [index, ingredient] of ingredients.entries()) {
        const previous = current?.ingredients.find(({ id }) => id === ingredient.id);
        await queueMutation({ entityType: "meal_template_item", recordId: previous?.id ?? ingredient.id, expectedRevision: previous?.revision ?? 0,
          payload: { template_id: templateId, name: ingredient.name.trim(), quantity: ingredient.quantity, unit: ingredient.unit,
            calories: ingredient.calories, protein_g: ingredient.protein_g, carbs_g: ingredient.carbs_g, fat_g: ingredient.fat_g,
            sort_order: previous?.sort_order ?? index, active: true } });
      }
      for (const itemId of removedIds) {
        const previous = current?.ingredients.find(({ id }) => id === itemId);
        if (previous) await queueMutation({ entityType: "meal_template_item_archive", recordId: itemId, expectedRevision: previous.revision ?? 1, payload: {} });
      }
      setForm(null); setEditTemplate(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The meal template could not be saved."); }
  }

  async function submitCheckin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const bodyWeight = number(data.get("checkin-weight"));
    const energy = number(data.get("checkin-energy"));
    const appetite = number(data.get("checkin-appetite"));
    const sleep = number(data.get("checkin-sleep"));
    const existing = snapshot.checkins.find(({ local_date }) => local_date === today);
    if ([bodyWeight, energy, appetite, sleep, optional(data.get("checkin-note"))].every((value) => value === null)) {
      setError("Add a check-in detail, or close the form to skip it."); return;
    }
    if ((energy !== null && (!Number.isInteger(energy) || energy < 1 || energy > 5))
      || (appetite !== null && (!Number.isInteger(appetite) || appetite < 1 || appetite > 5))
      || (sleep !== null && sleep > 24)) { setError("Use 1–5 whole numbers for ratings and no more than 24 hours of sleep."); return; }
    try {
      await queueMutation({ entityType: "nutrition_checkin", recordId: existing?.id ?? crypto.randomUUID(), expectedRevision: existing?.revision ?? 0,
        payload: { local_date: today, body_weight: bodyWeight, weight_unit: bodyWeight === null ? null : String(data.get("checkin-unit") || "kg"),
          energy, appetite, sleep_hours: sleep, note: optional(data.get("checkin-note")) } });
      setForm(null); setError("");
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The check-in could not be saved."); }
  }

  return <div className="health-page">
    <PageHeader title="Nutrition" subtitle="Flexible targets, meals that scale, and optional check-ins" />
    <div className="health-toolbar"><span className="health-sync">{offline ? "Offline · showing saved records" : online ? "Manual logging ready" : "Offline · logs save on this device"}</span><div className="health-actions"><button className="button button-secondary" type="button" onClick={() => { setForm("checkin"); setError(""); }}>Daily check-in <span className="optional-label">Optional</span></button><button className="button button-primary" type="button" onClick={() => { setEditTemplate(null); setForm("template"); setError(""); }}>New meal template</button></div></div>
    {error && <p className="form-message" role="alert">{error}</p>}
    <section className="health-section" aria-labelledby="nutrition-progress-title">
      <div className="health-section-heading"><div><span className="eyebrow">TODAY · {today}</span><h2 id="nutrition-progress-title">Nutrition so far</h2></div><button className="text-button" type="button" onClick={() => { setEditTarget(true); setForm("target"); }}> {snapshot.target ? "Edit targets" : "Set targets"} <span aria-hidden="true">→</span></button></div>
      {snapshot.target ? <div className="nutrition-target-grid">{([ ["Energy", todayTotals.calories, snapshot.target.calories, "kcal"], ["Protein", todayTotals.protein_g, snapshot.target.protein_g, "g"], ["Carbs", todayTotals.carbs_g, snapshot.target.carbs_g, "g"], ["Fat", todayTotals.fat_g, snapshot.target.fat_g, "g"] ] as const).map(([label, consumed, target, unit]) => <div className="nutrition-target" key={label}><span>{label}</span><strong>{round(consumed)} <small>/ {round(target)} {unit}</small></strong><div className="nutrition-progress-track" aria-label={`${label}: ${round(consumed)} of ${round(target)} ${unit}`}><span style={{ width: `${target > 0 ? Math.min(100, (consumed / target) * 100) : 0}%` }} /></div></div>)}</div> : <div className="health-empty"><h3>Choose a useful daily target.</h3><p>Targets are optional guides. Meal logging works without them.</p><button className="text-button" type="button" onClick={() => { setEditTarget(false); setForm("target"); }}>Set nutrition targets <span aria-hidden="true">→</span></button></div>}
      <div className="health-section-heading nutrition-meal-heading"><h3>Meals today</h3><span className="health-count">{todayMeals.length} logged</span></div>
      {todayMeals.length ? <div className="health-record-list">{todayMeals.map((meal) => <article className="health-record" key={meal.id}><div><strong>{meal.snapshot.template_name}</strong><small>{meal.meal_type} · {meal.snapshot.servings} serving{meal.snapshot.servings === 1 ? "" : "s"} · saved snapshot</small></div><span>{round(meal.snapshot.totals.calories)} kcal · P {round(meal.snapshot.totals.protein_g)}g</span></article>)}</div> : <p className="health-muted">No meals logged for today. A check-in is never required.</p>}
    </section>
    <section className="health-section" aria-labelledby="templates-title">
      <div className="health-section-heading"><div><span className="eyebrow">MEAL PLANNING</span><h2 id="templates-title">Meal templates</h2></div><span className="health-count">{snapshot.templates.length} saved</span></div>
      {snapshot.templates.length ? <div className="nutrition-template-grid">{snapshot.templates.map((template) => <MealTemplateCard key={template.id} template={template} onEdit={() => { setEditTemplate(template); setForm("template"); setError(""); }} onLog={async (servings) => {
        try { const snapshot = createMealSnapshot(template, servings); await queueMutation({ entityType: "meal_log", recordId: crypto.randomUUID(), expectedRevision: 0, payload: {
          local_date: today, logged_at: new Date().toISOString(), meal_type: template.meal_type, active: true,
          template_id: template.id, servings: snapshot.servings, snapshot,
        } as unknown as JsonValue }); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "The meal could not be logged."); }
      }} />)}</div> : <div className="health-empty"><h3>Save a meal you make often.</h3><p>Ingredient amounts and nutrition values scale together when you log a serving.</p><button className="text-button" type="button" onClick={() => setForm("template")}>Create a meal template <span aria-hidden="true">→</span></button></div>}
    </section>
    <section className="health-section" aria-labelledby="checkin-title"><div className="health-section-heading"><div><span className="eyebrow">OPTIONAL</span><h2 id="checkin-title">Daily check-in</h2></div><button className="text-button" type="button" onClick={() => setForm("checkin")}>{snapshot.checkins.some(({ local_date }) => local_date === today) ? "Edit today" : "Add today"}</button></div>{snapshot.checkins.some(({ local_date }) => local_date === today) ? <CheckinSummary checkin={snapshot.checkins.find(({ local_date }) => local_date === today)!} /> : <p className="health-muted">Skip this whenever you like. It does not affect targets, meals, or fitness logs.</p>}</section>
    {snapshot.mealLogs.filter(({ local_date, active }) => active && local_date !== today).length > 0 && <section className="health-section" aria-labelledby="meal-history-title"><div className="health-section-heading"><h2 id="meal-history-title">Recent meal history</h2><span className="health-count">Last 30 days</span></div><div className="health-record-list">{snapshot.mealLogs.filter(({ local_date, active }) => active && local_date !== today).slice(0, 20).map((meal) => <article className="health-record" key={meal.id}><div><strong>{meal.snapshot.template_name}</strong><small>{meal.local_date} · immutable log snapshot</small></div><span>{round(meal.snapshot.totals.calories)} kcal</span></article>)}</div></section>}
    {form === "target" && <HealthSheet eyebrow="NUTRITION" title={editTarget ? "Daily nutrition targets" : "Set nutrition targets"} error={error} onClose={() => setForm(null)}><form className="sheet-form" onSubmit={submitTarget}>
      <label className="field-label" htmlFor="target-calories">Calories<input id="target-calories" name="target-calories" type="number" min="1" step="1" required defaultValue={snapshot.target?.calories ?? ""} /></label>
      <div className="health-form-grid"><label className="field-label" htmlFor="target-protein">Protein (g)<input id="target-protein" name="target-protein" type="number" min="0" step="any" defaultValue={snapshot.target?.protein_g ?? ""} /></label><label className="field-label" htmlFor="target-carbs">Carbohydrates (g)<input id="target-carbs" name="target-carbs" type="number" min="0" step="any" defaultValue={snapshot.target?.carbs_g ?? ""} /></label></div>
      <label className="field-label" htmlFor="target-fat">Fat (g)<input id="target-fat" name="target-fat" type="number" min="0" step="any" defaultValue={snapshot.target?.fat_g ?? ""} /></label>
      <label className="field-label" htmlFor="target-date">Effective from<input id="target-date" name="target-date" type="date" defaultValue={snapshot.target?.effective_from ?? today} required /></label>
      <p className="health-muted">Targets are personal reference values. Meal logging works without setting targets.</p><button className="button button-primary" type="submit">Save targets</button>
    </form></HealthSheet>}
    {form === "template" && <MealTemplateForm template={editTemplate} error={error} onClose={() => { setForm(null); setEditTemplate(null); setError(""); }} onSubmit={submitTemplate} />}
    {form === "checkin" && <HealthSheet eyebrow="NUTRITION" title="Optional daily check-in" error={error} onClose={() => setForm(null)}><form className="sheet-form" onSubmit={submitCheckin}>
      <p className="health-muted">Every field is optional. You can log meals without a check-in.</p>
      <div className="health-form-grid"><label className="field-label" htmlFor="checkin-weight">Body weight<input id="checkin-weight" name="checkin-weight" type="number" min="0" step="any" defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.body_weight ?? ""} /></label><label className="field-label" htmlFor="checkin-unit">Unit<select id="checkin-unit" name="checkin-unit" defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.weight_unit ?? "kg"}><option value="kg">kg</option><option value="lb">lb</option></select></label></div>
      <div className="health-form-grid"><label className="field-label" htmlFor="checkin-energy">Energy · 1–5<input id="checkin-energy" name="checkin-energy" type="number" min="1" max="5" step="1" defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.energy ?? ""} /></label><label className="field-label" htmlFor="checkin-appetite">Appetite · 1–5<input id="checkin-appetite" name="checkin-appetite" type="number" min="1" max="5" step="1" defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.appetite ?? ""} /></label></div>
      <label className="field-label" htmlFor="checkin-sleep">Sleep (hours)<input id="checkin-sleep" name="checkin-sleep" type="number" min="0" max="24" step="0.25" defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.sleep_hours ?? ""} /></label>
      <label className="field-label" htmlFor="checkin-note">Note <span className="optional-label">Optional</span><textarea id="checkin-note" name="checkin-note" maxLength={1000} defaultValue={snapshot.checkins.find(({ local_date }) => local_date === today)?.note ?? ""} /></label>
      <button className="button button-primary" type="submit">Save check-in</button>
    </form></HealthSheet>}
  </div>;
}

function MealTemplateCard({ template, onEdit, onLog }: { template: MealTemplate; onEdit(): void; onLog(servings: number): Promise<void> }) {
  const [servings, setServings] = useState("1");
  const scaled = useMemo(() => { try { return createMealSnapshot(template, Number(servings)); } catch { return null; } }, [template, servings]);
  return <article className="nutrition-template"><div className="health-section-heading"><div><span className="eyebrow">{template.meal_type.toUpperCase()}</span><h3>{template.name}</h3></div><button className="text-button" type="button" onClick={onEdit}>Edit</button></div>{template.notes && <p>{template.notes}</p>}
    {template.ingredients.map((ingredient) => <div className="nutrition-ingredient" key={ingredient.id}><span>{ingredient.name}</span><span>{ingredient.quantity} {ingredient.unit}</span></div>)}
    <div className="nutrition-scaled"><label htmlFor={`servings-${template.id}`}>Servings<input id={`servings-${template.id}`} type="number" min="0.25" max="20" step="0.25" value={servings} onChange={(event) => setServings(event.target.value)} /></label><span>{scaled ? `${scaled.totals.calories} kcal · P ${scaled.totals.protein_g}g · C ${scaled.totals.carbs_g}g` : "Enter servings to scale"}</span></div>
    <button className="button button-primary" type="button" disabled={!scaled} onClick={() => { if (scaled) void onLog(scaled.servings); }}>Log meal snapshot</button>
  </article>;
}

function MealTemplateForm({ template, error, onClose, onSubmit }: { template: MealTemplate | null; error: string; onClose(): void; onSubmit(event: FormEvent<HTMLFormElement>, ingredients: MealTemplate["ingredients"], removedIds: string[]): void }) {
  const [ingredients, setIngredients] = useState<MealTemplate["ingredients"]>(template?.ingredients.map((item) => ({ ...item })) ?? [blankIngredient()]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  function update(index: number, key: keyof MealTemplate["ingredients"][number], raw: string) {
    setIngredients((rows) => rows.map((row, rowIndex) => rowIndex !== index ? row : {
      ...row, [key]: key === "name" || key === "unit" || key === "id" ? raw : Number(raw || 0),
    }));
  }
  return <HealthSheet eyebrow="NUTRITION" title={template ? "Edit meal template" : "Create meal template"} error={error} onClose={onClose}><form className="sheet-form" onSubmit={(event) => onSubmit(event, ingredients, removedIds)}>
    <label className="field-label" htmlFor="template-name">Meal name<input id="template-name" name="template-name" required maxLength={120} defaultValue={template?.name ?? ""} /></label>
    <label className="field-label" htmlFor="template-type">Meal type<select id="template-type" name="template-type" defaultValue={template?.meal_type ?? "breakfast"}>{["breakfast", "lunch", "dinner", "snack"].map((type) => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
    <label className="field-label" htmlFor="template-notes">Notes <span className="optional-label">Optional</span><textarea id="template-notes" name="template-notes" maxLength={1000} defaultValue={template?.notes ?? ""} /></label>
    <div className="health-section-heading"><h3>Ingredients and nutrition</h3><span className="optional-label">per template serving</span></div>
    {ingredients.map((ingredient, index) => <fieldset className="nutrition-ingredient-editor" key={ingredient.id}><legend>Ingredient {index + 1}</legend><label className="field-label" htmlFor={`ingredient-name-${index}`}>Name<input id={`ingredient-name-${index}`} value={ingredient.name} onChange={(event) => update(index, "name", event.target.value)} required maxLength={120} /></label>
      <div className="health-form-grid"><label className="field-label" htmlFor={`ingredient-quantity-${index}`}>Amount<input id={`ingredient-quantity-${index}`} type="number" min="0" step="any" value={ingredient.quantity} onChange={(event) => update(index, "quantity", event.target.value)} /></label><label className="field-label" htmlFor={`ingredient-unit-${index}`}>Unit<input id={`ingredient-unit-${index}`} value={ingredient.unit} onChange={(event) => update(index, "unit", event.target.value)} required maxLength={24} /></label></div>
      <div className="health-form-grid"><MacroInput id={`ingredient-calories-${index}`} label="Calories" value={ingredient.calories} onChange={(value) => update(index, "calories", value)} /><MacroInput id={`ingredient-protein-${index}`} label="Protein (g)" value={ingredient.protein_g} onChange={(value) => update(index, "protein_g", value)} /></div>
      <div className="health-form-grid"><MacroInput id={`ingredient-carbs-${index}`} label="Carbs (g)" value={ingredient.carbs_g} onChange={(value) => update(index, "carbs_g", value)} /><MacroInput id={`ingredient-fat-${index}`} label="Fat (g)" value={ingredient.fat_g} onChange={(value) => update(index, "fat_g", value)} /></div>
      <button className="text-button" type="button" onClick={() => { if (template?.ingredients.some(({ id }) => id === ingredient.id)) setRemovedIds((ids) => [...ids, ingredient.id]); setIngredients((rows) => rows.filter(({ id }) => id !== ingredient.id)); }}>Remove ingredient</button>
    </fieldset>)}
    <button className="button button-secondary" type="button" onClick={() => setIngredients((rows) => [...rows, blankIngredient()])}>Add ingredient</button>
    <p className="health-muted">When you log a meal, the ingredient names, amounts, and nutrition values are copied into a saved snapshot.</p>
    <button className="button button-primary" type="submit">{template ? "Save template" : "Create template"}</button>
  </form></HealthSheet>;
}

function MacroInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange(value: string): void }) {
  return <label className="field-label" htmlFor={id}>{label}<input id={id} type="number" min="0" step="any" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CheckinSummary({ checkin }: { checkin: NutritionCheckin }) {
  const values = [checkin.body_weight !== null ? `${checkin.body_weight} ${checkin.weight_unit}` : null, checkin.energy !== null ? `Energy ${checkin.energy}/5` : null, checkin.appetite !== null ? `Appetite ${checkin.appetite}/5` : null, checkin.sleep_hours !== null ? `${checkin.sleep_hours} h sleep` : null, checkin.note].filter(Boolean);
  return values.length ? <p className="health-banner">{values.join(" · ")}</p> : <p className="health-muted">Check-in saved with no details.</p>;
}


function blankIngredient(): MealTemplate["ingredients"][number] { return { id: crypto.randomUUID(), name: "", quantity: 0, unit: "g", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }; }
function number(value: FormDataEntryValue | null): number | null { if (value === null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function optional(value: FormDataEntryValue | null): string | null { const text = String(value ?? "").trim(); return text || null; }
function round(value: number): number { return Math.round(value * 10) / 10; }
