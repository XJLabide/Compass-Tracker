"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { projectBoardColumns } from "@/lib/projects/rules";
import type { Project, ProjectStage, ProjectTaskLink } from "@/lib/projects/types";
import type { PlanningSnapshot } from "@/lib/planning/types";
import { projectLocalPlanningMutations } from "@/lib/planning/projection";
import { loadProjectsSnapshot } from "@/lib/planning/repository";
import { listMutations } from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";

type ProjectFilter = Project["status"];
const emptySnapshot: PlanningSnapshot = {
  calendarEvents: [], externalCalendars: [], importedCalendarEvents: [], projects: [], projectStages: [],
  projectTaskLinks: [], tasks: [], lifeAreas: [], goals: [], goalUpdates: [], goalProjectLinks: [],
};
const initialStages = [
  { name: "Backlog", color: "cyan", sort_order: 0, is_complete: false, is_archived: false },
  { name: "In progress", color: "gold", sort_order: 1, is_complete: false, is_archived: false },
  { name: "Done", color: "violet", sort_order: 2, is_complete: true, is_archived: false },
];

export default function ProjectsPage() {
  const { database, refreshKey, queueMutation, setNotice } = useWorkspace();
  const [snapshot, setSnapshot] = useState<PlanningSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [taskSheetStage, setTaskSheetStage] = useState<ProjectStage | null>(null);
  const [stageSheetProject, setStageSheetProject] = useState<Project | null>(null);

  const reload = useCallback(async () => {
    if (!database) return;
    setLoading(true);
    try {
      const loaded = await loadProjectsSnapshot(createClient(), database);
      const mutations = await listMutations(database);
      const projected = projectLocalPlanningMutations(loaded.snapshot, mutations);
      setSnapshot(projected);
      setOffline(loaded.offline);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Projects could not be loaded.");
      setOffline(false);
    } finally {
      setLoading(false);
    }
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(task);
  }, [reload, refreshKey]);

  const visibleProjects = snapshot.projects.filter(({ status }) => status === filter).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const selectedProject = visibleProjects.find(({ id }) => id === selectedProjectId) ?? visibleProjects[0] ?? null;
  const stages = snapshot.projectStages.filter(({ project_id, is_archived }) => project_id === selectedProject?.id && !is_archived);
  const activeLinks = snapshot.projectTaskLinks.filter(({ project_id, active }) => project_id === selectedProject?.id && active);
  const columns = selectedProject
    ? projectBoardColumns(selectedProject.id, stages, activeLinks, snapshot.tasks.filter(({ status }) => status !== "archived"))
    : [];

  async function createProject(input: { title: string; description: string }) {
    const id = crypto.randomUUID();
    const stages = initialStages.map((stage) => ({ ...stage, id: crypto.randomUUID() }));
    await queueMutation({
      entityType: "project",
      recordId: id,
      expectedRevision: 0,
      payload: { title: input.title.trim(), description: input.description.trim() || null, status: "active", sort_order: snapshot.projects.length, stages },
    });
    setSelectedProjectId(id);
    setFilter("active");
  }

  async function updateProject(project: Project, payload: Record<string, string | number | null>) {
    await queueMutation({ entityType: "project", recordId: project.id, expectedRevision: project.revision, payload });
  }

  async function placeTask(input: { taskId: string; stage: ProjectStage; title?: string; description?: string }) {
    if (!selectedProject) return;
    let taskId = input.taskId;
    if (input.title) {
      taskId = crypto.randomUUID();
      await queueMutation({
        entityType: "task",
        recordId: taskId,
        expectedRevision: 0,
        payload: { title: input.title.trim(), details: input.description?.trim() || null, due_date: null, status: "open", sort_order: snapshot.tasks.length },
      });
    }
    const existing = snapshot.projectTaskLinks.find(({ project_id, task_id }) => project_id === selectedProject.id && task_id === taskId);
    if (existing) {
      await queueMutation({ entityType: "project_task_link", recordId: existing.id, expectedRevision: existing.revision, payload: { stage_id: input.stage.id, active: true } });
    } else {
      await queueMutation({
        entityType: "project_task_link",
        recordId: crypto.randomUUID(),
        expectedRevision: 0,
        payload: { project_id: selectedProject.id, task_id: taskId, stage_id: input.stage.id, sort_order: 0, active: true },
      });
    }
  }

  async function toggleTask(taskId: string) {
    const task = snapshot.tasks.find(({ id }) => id === taskId);
    if (!task) return;
    const status = task.status === "done" ? "open" : "done";
    await queueMutation({ entityType: "task", recordId: task.id, expectedRevision: task.revision, payload: { status } });
  }

  async function moveTask(link: ProjectTaskLink, stageId: string) {
    await queueMutation({ entityType: "project_task_link", recordId: link.id, expectedRevision: link.revision, payload: { stage_id: stageId } });
  }

  async function removeTask(link: ProjectTaskLink) {
    await queueMutation({ entityType: "project_task_link", recordId: link.id, expectedRevision: link.revision, payload: { active: false } });
  }

  return (
    <div className="daily-page projects-page">
      <PageHeader title="Projects" subtitle="Move shared tasks through stages" action={<button className="round-add" type="button" aria-label="Create a project" onClick={() => setProjectSheetOpen(true)}>+</button>} />
      <div className="segmented-control project-filters" role="group" aria-label="Project lifecycle">
        {(["active", "completed", "archived"] as const).map((item) => (
          <button className={filter === item ? "segment is-selected" : "segment"} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} key={item}>{capitalize(item)}</button>
        ))}
      </div>
      {offline && <div className="offline-banner" role="status"><strong>Offline view.</strong> Project edits will sync when you reconnect.</div>}
      {error && <p className="form-message" role="alert">{error}</p>}

      {loading ? <section className="surface-card loading-card" role="status">Loading projects…</section> : visibleProjects.length === 0 ? (
        <section className="surface-card project-empty-state">
          <span className="eyebrow">{filter === "active" ? "MAKE PROGRESS VISIBLE" : filter.toUpperCase()}</span>
          <h2>{filter === "active" ? "Give a project its own space." : `No ${filter} projects yet.`}</h2>
          <p>{filter === "active" ? "Create stages that fit the way this work moves. Tasks stay shared with your day and inbox." : "Project lifecycle stays separate from the tasks inside each board."}</p>
          {filter === "active" && <button className="button button-primary" type="button" onClick={() => setProjectSheetOpen(true)}>Create project</button>}
        </section>
      ) : (
        <>
          <nav className="project-picker" aria-label={`${filter} projects`}>
            {visibleProjects.map((project) => <button className={selectedProject?.id === project.id ? "project-picker-item is-selected" : "project-picker-item"} type="button" key={project.id} aria-pressed={selectedProject?.id === project.id} onClick={() => setSelectedProjectId(project.id)}>{project.title}</button>)}
          </nav>
          {selectedProject && <section className="surface-card project-board-card" aria-labelledby="project-board-title">
            <div className="project-board-heading">
              <div><span className="eyebrow">{capitalize(selectedProject.status)} PROJECT</span><h2 id="project-board-title">{selectedProject.title}</h2>{selectedProject.description && <p>{selectedProject.description}</p>}</div>
              <div className="project-actions">
                <button className="text-button" type="button" onClick={() => setStageSheetProject(selectedProject)}>Stages</button>
                {selectedProject.status === "active" ? <button className="text-button" type="button" onClick={() => void updateProject(selectedProject, { status: "completed" }).catch(showError)}>Complete</button> : <button className="text-button" type="button" onClick={() => void updateProject(selectedProject, { status: "active" }).catch(showError)}>Restore</button>}
                {selectedProject.status !== "archived" && <button className="text-button" type="button" onClick={() => void updateProject(selectedProject, { status: "archived" }).catch(showError)}>Archive</button>}
              </div>
            </div>
            {columns.length === 0 ? <div className="empty-inline"><p>This project has no active stages. Restore a stage to continue.</p><button className="text-button" type="button" onClick={() => setStageSheetProject(selectedProject)}>Manage stages</button></div> : (
              <div className="project-board" aria-label={`${selectedProject.title} board`}>
                {columns.map(({ stage, tasks }) => (
                  <section className="project-stage-column" key={stage.id} aria-labelledby={`stage-${stage.id}`}>
                    <div className="project-stage-heading"><h3 id={`stage-${stage.id}`}>{stage.name}</h3><span>{tasks.length}</span></div>
                    {tasks.map((task) => {
                      const link = activeLinks.find((row) => row.task_id === task.id);
                      return <article className="project-task-card" key={task.id}>
                        <label className="project-task-check"><input type="checkbox" checked={task.status === "done"} onChange={() => void toggleTask(task.id).catch(showError)} aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} /><span>{task.status === "done" ? "✓" : ""}</span></label>
                        <strong>{task.title}</strong>
                        {task.due_date && <small>Due {task.due_date}</small>}
                        {link && <div className="project-task-actions">
                          <label className="sr-only" htmlFor={`move-${link.id}`}>Move {task.title} to another stage</label>
                          <select id={`move-${link.id}`} value={stage.id} onChange={(event) => void moveTask(link, event.target.value).catch(showError)}>
                            {stages.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
                          </select>
                          <button className="text-button" type="button" onClick={() => void removeTask(link).catch(showError)}>Remove</button>
                        </div>}
                      </article>;
                    })}
                    <button className="project-add-task" type="button" onClick={() => setTaskSheetStage(stage)}>+ Add task</button>
                  </section>
                ))}
              </div>
            )}
          </section>}
        </>
      )}

      {projectSheetOpen && <ProjectSheet onClose={() => setProjectSheetOpen(false)} onCreate={(data) => createProject(data).then(() => setProjectSheetOpen(false))} />}
      {taskSheetStage && <ProjectTaskSheet stage={taskSheetStage} tasks={snapshot.tasks} links={snapshot.projectTaskLinks} projectId={selectedProject?.id ?? ""} onClose={() => setTaskSheetStage(null)} onAdd={(data) => placeTask({ ...data, stage: taskSheetStage }).then(() => setTaskSheetStage(null))} />}
      {stageSheetProject && <StageManager project={stageSheetProject} stages={snapshot.projectStages.filter(({ project_id }) => project_id === stageSheetProject.id)} onClose={() => setStageSheetProject(null)} onSave={async (stage, payload) => { await queueMutation({ entityType: "project_stage", recordId: stage.id, expectedRevision: stage.revision, payload }); }} onCreate={async (name) => { await queueMutation({ entityType: "project_stage", recordId: crypto.randomUUID(), expectedRevision: 0, payload: { project_id: stageSheetProject.id, name, sort_order: snapshot.projectStages.length, is_complete: false, is_archived: false } }); }} />}
    </div>
  );

  function showError(operationError: unknown) {
    setNotice(operationError instanceof Error ? operationError.message : "The project change could not be saved.");
  }
}

function ProjectSheet({ onClose, onCreate }: { onClose(): void; onCreate(value: { title: string; description: string }): Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return setError("Give this project a name.");
    setBusy(true);
    try { await onCreate({ title, description }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Project could not be created."); } finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="project-create-title"><div className="sheet-heading"><div><span className="eyebrow">PROJECT</span><h2 id="project-create-title">Create a project</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close project form">×</button></div><form className="sheet-form" onSubmit={submit}><label className="field-label" htmlFor="project-title">Name<input id="project-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field-label" htmlFor="project-description">Description <span className="optional-label">Optional</span><textarea id="project-description" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><p className="more-note">Start with Backlog, In progress, and Done. You can rename or add stages later.</p>{error && <p className="form-message" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create project"}</button></form></section></div>;
}

function ProjectTaskSheet({ stage, tasks, links, projectId, onClose, onAdd }: { stage: ProjectStage; tasks: PlanningSnapshot["tasks"]; links: ProjectTaskLink[]; projectId: string; onClose(): void; onAdd(value: { taskId: string; title?: string; description?: string }): Promise<void> }) {
  const [taskId, setTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linkedTaskIds = new Set(links.filter((link) => link.project_id === projectId && link.active).map(({ task_id }) => task_id));
  const available = tasks.filter(({ id, status }) => status !== "archived" && !linkedTaskIds.has(id));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskId && !title.trim()) return setError("Choose a task or create one first.");
    setBusy(true);
    try { await onAdd({ taskId, title: title.trim() || undefined, description }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Task could not be added."); } finally { setBusy(false); }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="project-task-title"><div className="sheet-heading"><div><span className="eyebrow">{stage.name}</span><h2 id="project-task-title">Add a shared task</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close task picker">×</button></div><form className="sheet-form" onSubmit={submit}><label className="field-label" htmlFor="project-task-existing">Choose an existing task<select id="project-task-existing" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">Select task</option>{available.map((task) => <option value={task.id} key={task.id}>{task.title}</option>)}</select></label><p className="more-note">Or create a task shared with your inbox and Today.</p><label className="field-label" htmlFor="project-task-new">New task name<input id="project-task-new" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field-label" htmlFor="project-task-details">Details <span className="optional-label">Optional</span><textarea id="project-task-details" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>{error && <p className="form-message" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add to project"}</button></form></section></div>;
}

function StageManager({ project, stages, onClose, onSave, onCreate }: { project: Project; stages: ProjectStage[]; onClose(): void; onSave(stage: ProjectStage, payload: Record<string, string | number | boolean>): Promise<void>; onCreate(name: string): Promise<void> }) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = stages.filter(({ is_archived }) => !is_archived).sort((a, b) => a.sort_order - b.sort_order);
  const archived = stages.filter(({ is_archived }) => is_archived).sort((a, b) => a.sort_order - b.sort_order);
  async function create() {
    if (!newName.trim()) return setError("Enter a stage name.");
    setBusy(true);
    try { await onCreate(newName.trim()); setNewName(""); setError(""); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Stage could not be added."); } finally { setBusy(false); }
  }
  async function archive(stage: ProjectStage) {
    setBusy(true);
    try { await onSave(stage, { is_archived: true }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Stage could not be archived."); } finally { setBusy(false); }
  }
  async function move(stage: ProjectStage, target: ProjectStage) {
    setBusy(true);
    try {
      await Promise.all([
        onSave(stage, { sort_order: target.sort_order }),
        onSave(target, { sort_order: stage.sort_order }),
      ]);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Stage order could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="stage-manager-title"><div className="sheet-heading"><div><span className="eyebrow">{project.title}</span><h2 id="stage-manager-title">Configure stages</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close stage manager">×</button></div><div className="project-stage-manager">{active.map((stage, index) => <StageEditor key={stage.id} stage={stage} index={index} count={active.length} busy={busy} onSave={onSave} onArchive={archive} onMove={(direction) => { const target = active[index + direction]; if (target) void move(stage, target); }} />)}</div>{archived.length > 0 && <details className="archived-stage-list"><summary>Archived stages · {archived.length}</summary>{archived.map((stage) => <StageEditor key={stage.id} stage={stage} index={0} count={0} busy={busy} onSave={onSave} onArchive={archive} onMove={() => undefined} />)}</details>}<div className="stage-add-row"><label className="sr-only" htmlFor="new-stage-name">New stage name</label><input id="new-stage-name" value={newName} maxLength={80} placeholder="Add a stage" onChange={(event) => setNewName(event.target.value)} /><button className="button button-secondary" type="button" disabled={busy} onClick={() => void create()}>Add</button></div>{error && <p className="form-message" role="alert">{error}</p>}</section></div>;
}

function StageEditor({ stage, index, count, busy, onSave, onArchive, onMove }: { stage: ProjectStage; index: number; count: number; busy: boolean; onSave(stage: ProjectStage, payload: Record<string, string | number | boolean>): Promise<void>; onArchive(stage: ProjectStage): Promise<void>; onMove(direction: number): void }) {
  const [name, setName] = useState(stage.name);
  const [isComplete, setIsComplete] = useState(stage.is_complete);
  const [error, setError] = useState("");
  async function save() {
    if (!name.trim()) return setError("Stage names cannot be empty.");
    try { await onSave(stage, { name: name.trim(), is_complete: isComplete }); setError(""); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Stage could not be updated."); }
  }
  return <div className={stage.is_archived ? "project-stage-editor is-archived" : "project-stage-editor"}><label className="field-label" htmlFor={`stage-name-${stage.id}`}>Stage name<input id={`stage-name-${stage.id}`} value={name} disabled={stage.is_archived} onChange={(event) => setName(event.target.value)} maxLength={80} /></label><label className="check-option"><input type="checkbox" checked={isComplete} onChange={(event) => setIsComplete(event.target.checked)} /><span>Completed stage</span></label><div className="stage-editor-actions">{!stage.is_archived && <><button className="text-button" type="button" disabled={busy || index === 0} onClick={() => onMove(-1)}>Move up</button><button className="text-button" type="button" disabled={busy || index === count - 1} onClick={() => onMove(1)}>Move down</button><button className="text-button" type="button" disabled={busy} onClick={() => void save()}>Save</button><button className="text-button" type="button" disabled={busy || count === 1} onClick={() => void onArchive(stage)}>Archive</button></>}{stage.is_archived && <button className="text-button" type="button" disabled={busy} onClick={() => void onSave(stage, { is_archived: false })}>Restore stage</button>}</div>{error && <p className="form-message" role="alert">{error}</p>}</div>;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
