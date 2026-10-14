"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { summarizeGoalProgress } from "@/lib/goals/rules";
import type { Goal, GoalKind, GoalProjectLink, GoalUpdate, LifeArea } from "@/lib/goals/types";
import type { Project } from "@/lib/projects/types";
import type { PlanningSnapshot } from "@/lib/planning/types";
import { projectLocalPlanningMutations } from "@/lib/planning/projection";
import { loadGoalsSnapshot } from "@/lib/planning/repository";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";

const emptySnapshot: PlanningSnapshot = {
  calendarEvents: [], externalCalendars: [], importedCalendarEvents: [], projects: [], projectStages: [],
  projectTaskLinks: [], tasks: [], lifeAreas: [], goals: [], goalUpdates: [], goalProjectLinks: [],
};

export default function GoalsPage() {
  const { database, refreshKey, queueMutation, setNotice } = useWorkspace();
  const [snapshot, setSnapshot] = useState<PlanningSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<Goal["status"]>("active");
  const [goalSheetOpen, setGoalSheetOpen] = useState(false);
  const [areaSheetOpen, setAreaSheetOpen] = useState(false);
  const [updateGoal, setUpdateGoal] = useState<Goal | null>(null);
  const [linkGoal, setLinkGoal] = useState<Goal | null>(null);

  const reload = useCallback(async () => {
    if (!database) return;
    try {
      const loaded = await loadGoalsSnapshot(createClient(), database);
      const mutations = await listMutations(database);
      setSnapshot(projectLocalPlanningMutations(loaded.snapshot, mutations));
      setOffline(loaded.offline);
      setError("");
    } catch (loadError) {
      setOffline(false);
      setError(loadError instanceof Error ? loadError.message : "Goals could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const visibleGoals = snapshot.goals.filter(({ status }) => status === statusFilter).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const activeAreas = snapshot.lifeAreas.filter(({ is_archived }) => !is_archived).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  async function createGoal(input: {
    title: string;
    description: string;
    kind: GoalKind;
    lifeAreaId: string | null;
    baseline: number | null;
    target: number | null;
    unit: string | null;
    direction: "increase" | "decrease" | null;
    dueDate: string | null;
  }) {
    await queueMutation({
      entityType: "goal",
      recordId: crypto.randomUUID(),
      expectedRevision: 0,
      payload: {
        title: input.title.trim(),
        description: input.description.trim() || null,
        kind: input.kind,
        status: "active",
        life_area_id: input.lifeAreaId,
        baseline_value: input.baseline,
        target_value: input.target,
        target_unit: input.unit,
        direction: input.direction,
        due_date: input.dueDate,
        sort_order: snapshot.goals.length,
      },
    });
  }

  async function updateStatus(goal: Goal, status: Goal["status"]) {
    await queueMutation({ entityType: "goal", recordId: goal.id, expectedRevision: goal.revision, payload: { status } });
  }

  async function addUpdate(goal: Goal, input: { value: number | null; unit: string | null; note: string | null; source: string }) {
    await queueMutation({
      entityType: "goal_update",
      recordId: crypto.randomUUID(),
      expectedRevision: 0,
      payload: { goal_id: goal.id, value: input.value, unit: input.unit, note: input.note, source: input.source.trim(), measured_at: new Date().toISOString(), active: true },
    });
  }

  async function saveArea(input: { id?: string; revision?: number; name: string; archived?: boolean }) {
    await queueMutation({
      entityType: "life_area",
      recordId: input.id ?? crypto.randomUUID(),
      expectedRevision: input.revision ?? 0,
      payload: input.id ? { name: input.name.trim(), is_archived: Boolean(input.archived) } : { name: input.name.trim(), sort_order: snapshot.lifeAreas.length, is_archived: false },
    });
  }

  async function setProjectLink(goal: Goal, projectId: string, active: boolean) {
    const existing = snapshot.goalProjectLinks.find((link) => link.goal_id === goal.id && link.project_id === projectId);
    if (existing) {
      await queueMutation({ entityType: "goal_project_link", recordId: existing.id, expectedRevision: existing.revision, payload: { active } });
    } else if (active) {
      await queueMutation({ entityType: "goal_project_link", recordId: crypto.randomUUID(), expectedRevision: 0, payload: { goal_id: goal.id, project_id: projectId, active: true } });
    }
  }

  return (
    <div className="daily-page goals-page">
      <PageHeader title="Goals" subtitle="Qualitative commitments and measurable progress" action={<button className="round-add" type="button" aria-label="Create a goal" onClick={() => setGoalSheetOpen(true)}>+</button>} />
      {offline && <div className="offline-banner" role="status"><strong>Offline view.</strong> New updates stay on this device until sync.</div>}
      {error && <p className="form-message" role="alert">{error}</p>}
      <section className="surface-card life-areas-card" aria-labelledby="life-areas-title">
        <div className="surface-heading"><h2 id="life-areas-title">Life areas</h2><button className="text-button" type="button" onClick={() => setAreaSheetOpen(true)}>Edit areas</button></div>
        {activeAreas.length === 0 ? <p className="empty-copy">Add areas that matter to you. Goals can stay ungrouped too.</p> : <div className="life-area-list">{activeAreas.map((area) => <span className="life-area-chip" key={area.id}>{area.name}</span>)}</div>}
      </section>

      <div className="segmented-control goal-filters" role="group" aria-label="Goal lifecycle">
        {(["active", "completed", "archived"] as const).map((item) => <button className={statusFilter === item ? "segment is-selected" : "segment"} type="button" aria-pressed={statusFilter === item} onClick={() => setStatusFilter(item)} key={item}>{capitalize(item)}</button>)}
      </div>

      {loading ? <div className="surface-card loading-card" role="status">Loading goals…</div> : visibleGoals.length === 0 ? (
        <section className="surface-card goal-empty-state"><span className="eyebrow">A DIRECTION, NOT A DEADLINE</span><h2>{statusFilter === "active" ? "What would you like to move toward?" : `No ${statusFilter} goals.`}</h2><p>Qualitative goals stay descriptive. Measurable goals show their recorded values and sources over time.</p>{statusFilter === "active" && <button className="button button-primary" type="button" onClick={() => setGoalSheetOpen(true)}>Create a goal</button>}</section>
      ) : visibleGoals.map((goal) => {
        const updates = snapshot.goalUpdates.filter(({ goal_id, active }) => goal_id === goal.id && active).sort((a, b) => b.measured_at.localeCompare(a.measured_at));
        const progress = summarizeGoalProgress(goal, updates);
        const linkedProjects = snapshot.goalProjectLinks.filter(({ goal_id, active }) => goal_id === goal.id && active).map(({ project_id }) => snapshot.projects.find(({ id }) => id === project_id)).filter((project): project is NonNullable<typeof project> => Boolean(project));
        const area = snapshot.lifeAreas.find(({ id }) => id === goal.life_area_id);
        return <GoalCard key={goal.id} goal={goal} updates={updates} progress={progress} area={area?.name ?? null} linkedProjects={linkedProjects.map(({ id, title }) => ({ id, title }))} onRecord={() => setUpdateGoal(goal)} onLink={() => setLinkGoal(goal)} onStatus={(status) => void updateStatus(goal, status).catch(showError)} />;
      })}

      {goalSheetOpen && <GoalSheet areas={activeAreas} onClose={() => setGoalSheetOpen(false)} onCreate={(input) => createGoal(input).then(() => setGoalSheetOpen(false))} />}
      {updateGoal && <GoalUpdateSheet goal={updateGoal} onClose={() => setUpdateGoal(null)} onSave={(input) => addUpdate(updateGoal, input).then(() => setUpdateGoal(null))} />}
      {areaSheetOpen && <LifeAreasSheet areas={snapshot.lifeAreas} onClose={() => setAreaSheetOpen(false)} onSave={saveArea} />}
      {linkGoal && <GoalProjectsSheet goal={linkGoal} projects={snapshot.projects.filter(({ status }) => status === "active")} links={snapshot.goalProjectLinks} onClose={() => setLinkGoal(null)} onToggle={(projectId, active) => { void setProjectLink(linkGoal, projectId, active).catch(showError); }} />}
    </div>
  );

  function showError(operationError: unknown) {
    setNotice(operationError instanceof Error ? operationError.message : "The goal change could not be saved.");
  }
}

function GoalCard({ goal, updates, progress, area, linkedProjects, onRecord, onLink, onStatus }: {
  goal: Goal;
  updates: GoalUpdate[];
  progress: ReturnType<typeof summarizeGoalProgress>;
  area: string | null;
  linkedProjects: Array<{ id: string; title: string }>;
  onRecord(): void;
  onLink(): void;
  onStatus(status: Goal["status"]): void;
}) {
  const progressLabel = progress.change === null ? "" : `${progress.change > 0 ? "+" : ""}${progress.change}${goal.target_unit ? ` ${goal.target_unit}` : ""} since previous update`;
  return <article className="surface-card goal-card">
    <div className="goal-card-heading"><div><span className="eyebrow">{goal.kind === "measurable" ? "MEASURABLE" : "QUALITATIVE"}{area ? ` · ${area}` : ""}</span><h2>{goal.title}</h2></div><button className="row-chevron" type="button" aria-label={`Goal options for ${goal.title}`} onClick={() => onStatus(goal.status === "active" ? "completed" : "active")}>{goal.status === "active" ? "✓" : "↶"}</button></div>
    {goal.description && <p className="goal-description">{goal.description}</p>}
    {goal.kind === "measurable" && <div className="goal-measure-summary">
      <div><strong>{progress.latestValue === null ? "No measurement yet" : `${progress.latestValue} ${goal.target_unit}`}</strong><small>{goal.target_value} {goal.target_unit} target · {progress.percentToTarget === null ? "no progress recorded yet" : `${progress.percentToTarget}% of target`}</small></div>
      {progress.percentToTarget !== null && <div className="goal-progress-track" role="progressbar" aria-label={`${goal.title} recorded progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percentToTarget}><span style={{ width: `${progress.percentToTarget}%` }} /></div>}
      {progressLabel && <small>{progressLabel}{progress.source ? ` · source: ${progress.source}` : ""}</small>}
    </div>}
    {goal.kind === "qualitative" && <p className="goal-latest-note">{progress.latestNote ?? "No note recorded yet."}</p>}
    <div className="goal-linked-projects">{linkedProjects.length ? linkedProjects.map(({ id, title }) => <span className="life-area-chip" key={id}>{title}</span>) : <span className="goal-muted">No linked projects</span>}</div>
    {updates.length > 0 && <details className="goal-history"><summary>Progress history · {updates.length}</summary><div className="goal-update-list">{updates.slice(0, 6).map((update) => <div className="goal-update-row" key={update.id}><time dateTime={update.measured_at}>{formatDate(update.measured_at)}</time><span>{update.value === null ? update.note : `${update.value} ${update.unit ?? goal.target_unit}`}</span><small>Source · {update.source}</small></div>)}</div></details>}
    <div className="goal-card-actions"><button className="text-button" type="button" onClick={onRecord}>{goal.kind === "measurable" ? "Record measurement" : "Add progress note"}</button><button className="text-button" type="button" onClick={onLink}>Link project</button>{goal.status === "archived" ? <button className="text-button" type="button" onClick={() => onStatus("active")}>Restore</button> : goal.status === "completed" ? <button className="text-button" type="button" onClick={() => onStatus("archived")}>Archive</button> : <button className="text-button" type="button" onClick={() => onStatus("archived")}>Archive</button>}</div>
  </article>;
}

function GoalSheet({ areas, onClose, onCreate }: { areas: LifeArea[]; onClose(): void; onCreate(value: { title: string; description: string; kind: GoalKind; lifeAreaId: string | null; baseline: number | null; target: number | null; unit: string | null; direction: "increase" | "decrease" | null; dueDate: string | null }): Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<GoalKind>("qualitative");
  const [lifeAreaId, setLifeAreaId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Give this goal a name.");
    if (kind === "measurable" && (!unit.trim() || target === "" || !Number.isFinite(Number(target)))) return setError("Measurable goals need a target and unit.");
    setBusy(true);
    try { await onCreate({ title, description, kind, lifeAreaId: lifeAreaId || null, baseline: kind === "measurable" && baseline !== "" ? Number(baseline) : null, target: kind === "measurable" ? Number(target) : null, unit: kind === "measurable" ? unit.trim() : null, direction: kind === "measurable" ? direction : null, dueDate: dueDate || null }); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Goal could not be created."); }
    finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="goal-create-title"><div className="sheet-heading"><div><span className="eyebrow">GOAL</span><h2 id="goal-create-title">Set a direction</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close goal form">×</button></div><form className="sheet-form" onSubmit={submit}><label className="field-label" htmlFor="goal-title">Name<input id="goal-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field-label" htmlFor="goal-description">Description <span className="optional-label">Optional</span><textarea id="goal-description" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field-label" htmlFor="goal-kind">Type<select id="goal-kind" value={kind} onChange={(event) => setKind(event.target.value as GoalKind)}><option value="qualitative">Qualitative</option><option value="measurable">Measurable</option></select></label><label className="field-label" htmlFor="goal-area">Life area <span className="optional-label">Optional</span><select id="goal-area" value={lifeAreaId} onChange={(event) => setLifeAreaId(event.target.value)}><option value="">No area</option>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label>{kind === "measurable" && <div className="goal-measure-fields"><label className="field-label" htmlFor="goal-baseline">Starting value <span className="optional-label">Optional</span><input id="goal-baseline" type="number" step="any" value={baseline} onChange={(event) => setBaseline(event.target.value)} /></label><label className="field-label" htmlFor="goal-target">Target<input id="goal-target" type="number" step="any" value={target} onChange={(event) => setTarget(event.target.value)} /></label><label className="field-label" htmlFor="goal-unit">Unit<input id="goal-unit" maxLength={32} placeholder="books, minutes, sessions…" value={unit} onChange={(event) => setUnit(event.target.value)} /></label><label className="field-label" htmlFor="goal-direction">Progress direction<select id="goal-direction" value={direction} onChange={(event) => setDirection(event.target.value as "increase" | "decrease")}><option value="increase">Increase toward target</option><option value="decrease">Decrease toward target</option></select></label></div>}<label className="field-label" htmlFor="goal-due">Target date <span className="optional-label">Optional</span><input id="goal-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>{error && <p className="form-message" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create goal"}</button></form></section></div>;
}

function GoalUpdateSheet({ goal, onClose, onSave }: { goal: Goal; onClose(): void; onSave(value: { value: number | null; unit: string | null; note: string | null; source: string }): Promise<void> }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source.trim()) return setError("Record where this update came from.");
    if (goal.kind === "measurable" && (value === "" || !Number.isFinite(Number(value)))) return setError("Enter a measurement.");
    if (goal.kind === "qualitative" && !note.trim()) return setError("Add a short progress note.");
    setBusy(true);
    try { await onSave({ value: goal.kind === "measurable" ? Number(value) : null, unit: goal.kind === "measurable" ? goal.target_unit : null, note: note.trim() || null, source }); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Progress update could not be saved."); }
    finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="goal-update-title"><div className="sheet-heading"><div><span className="eyebrow">PROGRESS UPDATE</span><h2 id="goal-update-title">{goal.title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close progress form">×</button></div><form className="sheet-form" onSubmit={submit}>{goal.kind === "measurable" ? <label className="field-label" htmlFor="goal-value">Current value · {goal.target_unit}<input id="goal-value" type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} /></label> : <label className="field-label" htmlFor="goal-note">What moved forward?<textarea id="goal-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>}<label className="field-label" htmlFor="goal-source">Source<input id="goal-source" maxLength={160} placeholder="Manual check-in, book log…" value={source} onChange={(event) => setSource(event.target.value)} /></label>{error && <p className="form-message" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save update"}</button></form></section></div>;
}

function LifeAreasSheet({ areas, onClose, onSave }: { areas: LifeArea[]; onClose(): void; onSave(input: { id?: string; revision?: number; name: string; archived?: boolean }): Promise<void> }) {
  const [newName, setNewName] = useState("");
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(areas.map((area) => [area.id, area.name])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!newName.trim()) return setError("Enter an area name.");
    setBusy(true);
    try { await onSave({ name: newName }); setNewName(""); setError(""); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Life area could not be created."); }
    finally { setBusy(false); }
  }
  async function save(area: LifeArea, archived = false) {
    setBusy(true);
    try { await onSave({ id: area.id, revision: area.revision, name: names[area.id] ?? area.name, archived }); setError(""); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Life area could not be updated."); }
    finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="life-area-title"><div className="sheet-heading"><div><span className="eyebrow">GOAL GROUPING</span><h2 id="life-area-title">Edit life areas</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close life area editor">×</button></div><div className="life-area-editor-list">{areas.map((area) => <div className="life-area-editor-row" key={area.id}><label className="field-label" htmlFor={`area-${area.id}`}>Area name<input id={`area-${area.id}`} value={names[area.id] ?? area.name} disabled={area.is_archived} onChange={(event) => setNames((current) => ({ ...current, [area.id]: event.target.value }))} /></label>{!area.is_archived && <button className="text-button" type="button" disabled={busy} onClick={() => void save(area)}>Save</button>}{!area.is_archived && <button className="text-button" type="button" disabled={busy} onClick={() => void save(area, true)}>Archive</button>}{area.is_archived && <button className="text-button" type="button" disabled={busy} onClick={() => void save(area, false)}>Restore</button>}</div>)}</div><div className="stage-add-row"><label className="sr-only" htmlFor="new-life-area">New life area</label><input id="new-life-area" placeholder="Add a life area" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} /><button className="button button-secondary" type="button" disabled={busy} onClick={() => void add()}>Add</button></div>{error && <p className="form-message" role="alert">{error}</p>}</section></div>;
}

function GoalProjectsSheet({ goal, projects, links, onClose, onToggle }: { goal: Goal; projects: Project[]; links: GoalProjectLink[]; onClose(): void; onToggle(projectId: string, active: boolean): void }) {
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="goal-projects-title"><div className="sheet-heading"><div><span className="eyebrow">OPTIONAL CONNECTION</span><h2 id="goal-projects-title">Link a project</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close project links">×</button></div><p className="sheet-intro">Linking keeps progress connected while each project and goal remains its own record.</p>{projects.length === 0 ? <p className="empty-copy">Create an active project to link it here.</p> : projects.map((project) => { const linked = links.find((link) => link.goal_id === goal.id && link.project_id === project.id && link.active); return <label className="check-option goal-project-choice" key={project.id}><input type="checkbox" checked={Boolean(linked)} onChange={(event) => onToggle(project.id, event.target.checked)} /><span>{project.title}</span></label>; })}</section></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
