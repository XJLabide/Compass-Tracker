"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type DragEvent as ReactDragEvent } from "react";
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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingLinkId, setDraggingLinkId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ title: string; x: number; y: number } | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const dragLinkRef = useRef<string | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragModeRef = useRef<"touch-pending" | "touch" | "native" | null>(null);

  const reload = useCallback(async () => {
    if (!database) return;
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
  const selectedTask = snapshot.tasks.find(({ id }) => id === selectedTaskId) ?? null;
  const selectedTaskStage = selectedTask
    ? stages.find(({ id }) => id === activeLinks.find(({ task_id }) => task_id === selectedTask.id)?.stage_id)
    : null;
  const dragPreviewStyle = dragPreview && typeof window !== "undefined" ? {
    left: `${Math.max(12, Math.min(dragPreview.x + 12, window.innerWidth - 284))}px`,
    top: `${Math.max(12, Math.min(dragPreview.y + 12, window.innerHeight - 68))}px`,
  } : undefined;

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

  async function advanceTaskStage(taskId: string) {
    const task = snapshot.tasks.find(({ id }) => id === taskId);
    const link = activeLinks.find(({ task_id }) => task_id === taskId);
    if (!task || !link) return;

    const currentStageIndex = columns.findIndex(({ stage }) => stage.id === link.stage_id);
    if (currentStageIndex < 0) return;
    const isChecked = task.status === "done" && columns[currentStageIndex].stage.is_complete;
    const destination = columns[currentStageIndex + (isChecked ? -1 : 1)];
    if (!destination) return;

    const status = destination.stage.is_complete ? "done" : "open";
    const taskMutation = status === task.status ? null : await queueMutation({
      entityType: "task",
      recordId: task.id,
      expectedRevision: task.revision,
      payload: { status },
    });
    const linkMutation = await queueMutation({
      entityType: "project_task_link",
      recordId: link.id,
      expectedRevision: link.revision,
      payload: { stage_id: destination.stage.id },
    });
    setSnapshot((current) => projectLocalPlanningMutations(current, [taskMutation, linkMutation].filter((mutation) => mutation !== null)));
  }

  async function moveTask(link: ProjectTaskLink, stageId: string) {
    if (link.stage_id === stageId) return;
    const mutation = await queueMutation({ entityType: "project_task_link", recordId: link.id, expectedRevision: link.revision, payload: { stage_id: stageId } });
    setSnapshot((current) => projectLocalPlanningMutations(current, [mutation]));
  }

  function clearDragState() {
    if (dragTimerRef.current !== null) window.clearTimeout(dragTimerRef.current);
    dragTimerRef.current = null;
    dragLinkRef.current = null;
    dragStartPointRef.current = null;
    dragModeRef.current = null;
    setDraggingLinkId(null);
    setDropStageId(null);
    setDragPreview(null);
  }

  function beginTaskDrag(event: ReactDragEvent<HTMLButtonElement>, link: ProjectTaskLink) {
    if (!event.dataTransfer) return;
    if (dragTimerRef.current !== null) window.clearTimeout(dragTimerRef.current);
    dragTimerRef.current = null;
    dragModeRef.current = "native";
    dragLinkRef.current = link.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/project-task-link", link.id);
    const card = event.currentTarget.closest<HTMLElement>(".project-task-card");
    if (card) {
      const rect = card.getBoundingClientRect();
      const preview = card.cloneNode(true) as HTMLElement;
      preview.removeAttribute("id");
      preview.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      preview.setAttribute("aria-hidden", "true");
      preview.classList.remove("is-dragging");
      preview.style.position = "fixed";
      preview.style.top = "-10000px";
      preview.style.left = "-10000px";
      preview.style.width = `${rect.width}px`;
      preview.style.opacity = ".78";
      preview.style.borderColor = "var(--accent)";
      document.body.append(preview);
      event.dataTransfer.setDragImage(preview, Math.min(event.clientX - rect.left, rect.width - 1), Math.min(event.clientY - rect.top, rect.height - 1));
      window.requestAnimationFrame(() => preview.remove());
    }
    setDraggingLinkId(link.id);
  }

  function beginTouchDrag(event: ReactPointerEvent<HTMLButtonElement>, link: ProjectTaskLink, title: string) {
    if (event.pointerType !== "touch") return;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    dragModeRef.current = "touch-pending";
    dragLinkRef.current = link.id;
    dragStartPointRef.current = { x: startX, y: startY };
    dragTimerRef.current = window.setTimeout(() => {
      if (dragModeRef.current !== "touch-pending") return;
      dragModeRef.current = "touch";
      try { target.setPointerCapture(pointerId); } catch { /* The pointer may have been released. */ }
      setDraggingLinkId(link.id);
      setDragPreview({ title, x: startX, y: startY });
    }, 260);
  }

  function continueTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragModeRef.current === "touch-pending" && dragStartPointRef.current) {
      const distance = Math.hypot(event.clientX - dragStartPointRef.current.x, event.clientY - dragStartPointRef.current.y);
      if (distance > 8) clearDragState();
      return;
    }
    if (dragModeRef.current !== "touch") return;
    event.preventDefault();
    const stage = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-project-stage-id]");
    setDropStageId(stage?.dataset.projectStageId ?? null);
    setDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
  }

  function finishTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragModeRef.current === "native") return;
    if (dragModeRef.current === "touch") {
      const stage = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-project-stage-id]");
      const targetStageId = stage?.dataset.projectStageId;
      const link = snapshot.projectTaskLinks.find(({ id, active }) => id === dragLinkRef.current && active);
      if (link && targetStageId && targetStageId !== link.stage_id) void moveTask(link, targetStageId).catch(showError);
    }
    clearDragState();
  }

  function allowTaskDrop(event: ReactDragEvent<HTMLElement>, stage: ProjectStage) {
    const isTaskDrag = event.dataTransfer.types.includes("text/project-task-link") || dragModeRef.current === "touch";
    if (!isTaskDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropStageId(stage.id);
  }

  function dropTask(event: ReactDragEvent<HTMLElement>, stage: ProjectStage) {
    const linkId = event.dataTransfer.getData("text/project-task-link") || dragLinkRef.current;
    if (!linkId) return;
    event.preventDefault();
    const link = snapshot.projectTaskLinks.find(({ id, active }) => id === linkId && active);
    if (link && link.stage_id !== stage.id) void moveTask(link, stage.id).catch(showError);
    clearDragState();
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
              <div className="project-board-copy">
                <div className="project-board-title-row">
                  <h2 id="project-board-title">{selectedProject.title}</h2>
                  <span className={`project-status-dot is-${selectedProject.status}`} role="img" aria-label={capitalize(selectedProject.status)} title={capitalize(selectedProject.status)} />
                </div>
                {selectedProject.description && <p className="project-board-description">{selectedProject.description}</p>}
              </div>
              <ProjectActionsMenu actions={[
                { label: "Stages", onSelect: () => setStageSheetProject(selectedProject) },
                { label: selectedProject.status === "active" ? "Complete" : "Restore", onSelect: () => void updateProject(selectedProject, { status: selectedProject.status === "active" ? "completed" : "active" }).catch(showError) },
                ...(selectedProject.status !== "archived" ? [{ label: "Archive", onSelect: () => void updateProject(selectedProject, { status: "archived" }).catch(showError) }] : []),
              ]} />
            </div>
            {columns.length === 0 ? <div className="empty-inline"><p>This project has no active stages. Restore a stage to continue.</p><button className="text-button" type="button" onClick={() => setStageSheetProject(selectedProject)}>Manage stages</button></div> : (
              <div className="project-board" aria-label={`${selectedProject.title} board`}>
                {columns.map(({ stage, tasks }) => (
                  <section
                    className={`project-stage-column${dropStageId === stage.id ? " is-drop-target" : ""}`}
                    key={stage.id}
                    data-project-stage-id={stage.id}
                    aria-labelledby={`stage-${stage.id}`}
                    onDragOver={(event) => allowTaskDrop(event, stage)}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStageId(null); }}
                    onDrop={(event) => dropTask(event, stage)}
                  >
                    <div className="project-stage-heading"><h3 id={`stage-${stage.id}`}>{stage.name}</h3><span>{tasks.length}</span></div>
                    {tasks.map((task) => {
                      const link = activeLinks.find((row) => row.task_id === task.id);
                      const isDragging = Boolean(link && draggingLinkId === link.id);
                      const stageIndex = columns.findIndex(({ stage: boardStage }) => boardStage.id === stage.id);
                      const isTaskChecked = stage.is_complete && task.status === "done";
                      const canAdvance = isTaskChecked ? stageIndex > 0 : stageIndex < columns.length - 1;
                      return <article className={`project-task-card${isDragging ? " is-dragging" : ""}`} key={task.id} onClick={(event) => {
                        if (event.target instanceof Element && event.target.closest("button, input, select, label")) return;
                        setSelectedTaskId(task.id);
                      }}>
                        <div className="project-task-heading">
                          <label className="project-task-check"><input type="checkbox" checked={isTaskChecked} disabled={!link || !canAdvance} onChange={() => void advanceTaskStage(task.id).catch(showError)} aria-label={`${isTaskChecked ? "Move back one stage" : "Move to the next stage"}: ${task.title}`} /><span>{isTaskChecked ? "✓" : ""}</span></label>
                          <button className="project-task-title" type="button" aria-haspopup="dialog" onClick={() => setSelectedTaskId(task.id)}>{task.title}</button>
                          {link && <button
                            className="project-task-drag-handle"
                            type="button"
                            draggable
                            aria-label={`Drag ${task.title} to another stage; use the stage menu as an alternative`}
                            title="Drag to another stage"
                            onDragStart={(event) => beginTaskDrag(event, link)}
                            onDragEnd={clearDragState}
                            onPointerDown={(event) => beginTouchDrag(event, link, task.title)}
                            onPointerMove={continueTouchDrag}
                            onPointerUp={finishTouchDrag}
                            onPointerCancel={clearDragState}
                          ><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="3" r="1" /><circle cx="11" cy="3" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="13" r="1" /><circle cx="11" cy="13" r="1" /></svg></button>}
                        </div>
                        {task.due_date && <small>Due {task.due_date}</small>}
                        {link && <div className="project-task-actions">
                          <label className="sr-only" htmlFor={`move-${link.id}`}>Move {task.title} to another stage</label>
                          <select id={`move-${link.id}`} value={stage.id} onChange={(event) => void moveTask(link, event.target.value).catch(showError)}>
                            {stages.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
                          </select>
                          <button className="project-task-remove" type="button" aria-label={`Remove ${task.title} from ${stage.name}`} title="Remove from project" onClick={() => void removeTask(link).catch(showError)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13M8 5.5V3.7h4v1.8m-6.8 0 .7 10.1c.1.7.6 1.2 1.3 1.2h5.6c.7 0 1.2-.5 1.3-1.2l.7-10.1M8.2 8.2v5.8m3.6-5.8v5.8" /></svg></button>
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
      {selectedTask && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTaskId(null); }}><section className="sheet-panel project-task-details-dialog" role="dialog" aria-modal="true" aria-labelledby="project-task-details-title"><div className="sheet-heading"><div><span className="eyebrow">{selectedTaskStage?.name ?? "PROJECT TASK"}</span><h2 id="project-task-details-title">{selectedTask.title}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedTaskId(null)} aria-label="Close task details">×</button></div><div className="project-task-details-content"><h3>Details</h3><p>{selectedTask.details?.trim() || "No details added."}</p>{selectedTask.due_date && <p className="project-task-due">Due {selectedTask.due_date}</p>}</div></section></div>}
      {dragPreview && <div className="project-task-drag-preview" style={dragPreviewStyle} aria-hidden="true"><span className="project-task-drag-preview-check" /><strong>{dragPreview.title}</strong><svg viewBox="0 0 16 16"><circle cx="5" cy="3" r="1" /><circle cx="11" cy="3" r="1" /><circle cx="5" cy="8" r="1" /><circle cx="11" cy="8" r="1" /><circle cx="5" cy="13" r="1" /><circle cx="11" cy="13" r="1" /></svg></div>}
    </div>
  );

  function showError(operationError: unknown) {
    setNotice(operationError instanceof Error ? operationError.message : "The project change could not be saved.");
  }
}

interface ProjectAction {
  label: string;
  onSelect(): void;
}

function ProjectActionsMenu({ actions }: { actions: ProjectAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="project-actions-menu" ref={rootRef}>
    <button ref={triggerRef} className="project-actions-trigger" type="button" aria-label="Project actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="16" cy="10" r="1.3" /></svg>
    </button>
    {open && <div className="project-actions-menu-panel" role="menu">{actions.map((action, index) => <button ref={index === 0 ? firstActionRef : undefined} type="button" role="menuitem" key={action.label} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}</div>}
  </div>;
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
