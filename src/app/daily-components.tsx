"use client";

import { useEffect, useState, type FormEvent } from "react";
import { nextPriorityRank, validateEndDayReview } from "@/lib/daily/rules";
import type { DailyPlan, Priority, Task } from "@/lib/daily/types";
import { useWorkspace } from "@/app/app-workspace";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

export function CaptureButton({ onClick }: { onClick(): void }) {
  return (
    <button className="capture-button" type="button" onClick={onClick}>
      <span aria-hidden="true">+</span><span>Capture</span>
    </button>
  );
}

export function CaptureSheet({
  plan,
  priorities,
  defaultType = "task",
  defaultTaskDate,
  onClose,
  onSaved,
}: {
  plan: DailyPlan | null;
  priorities: Priority[];
  defaultType?: "task" | "priority";
  defaultTaskDate?: string | null;
  onClose(): void;
  onSaved(): void;
}) {
  const { queueMutation, setNotice } = useWorkspace();
  const [kind, setKind] = useState<"task" | "priority">(defaultType);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState(defaultTaskDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextRank = nextPriorityRank(priorities.filter(({ state }) => state === "active"));
  const canCreatePriority = plan !== null && plan.status !== "ended" && nextRank !== undefined;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Add a short title first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (kind === "priority") {
        if (!canCreatePriority || !plan || nextRank === undefined) {
          setError("This day already has three priorities, or it is closed. Edit a priority or choose another day.");
          return;
        }
        await queueMutation({
          entityType: "priority",
          recordId: crypto.randomUUID(),
          expectedRevision: 0,
          payload: { daily_plan_id: plan.id, rank: nextRank, title: cleanTitle, outcome: null, state: "active" },
        });
      } else {
        await queueMutation({
          entityType: "task",
          recordId: crypto.randomUUID(),
          expectedRevision: 0,
          payload: {
            title: cleanTitle,
            details: details.trim() || null,
            due_date: dueDate || null,
            status: "open",
            sort_order: 0,
          },
        });
      }
      onSaved();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save this item.");
      setNotice("The item is still available to retry if its save was queued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="capture-title">
        <div className="sheet-heading">
          <div><span className="eyebrow">QUICK CAPTURE</span><h2 id="capture-title">Make a little room</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close quick capture">×</button>
        </div>
        <div className="segmented-control" role="group" aria-label="Capture type">
          <button className={kind === "task" ? "segment is-selected" : "segment"} type="button" aria-pressed={kind === "task"} onClick={() => setKind("task")}>Task</button>
          <button className={kind === "priority" ? "segment is-selected" : "segment"} type="button" aria-pressed={kind === "priority"} disabled={!canCreatePriority} onClick={() => setKind("priority")}>Priority</button>
        </div>
        <form className="sheet-form" onSubmit={submit}>
          <label className="field-label" htmlFor="capture-title-input">
            {kind === "priority" ? "What matters today?" : "What needs doing?"}
            <input id="capture-title-input" autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          {kind === "task" && (
            <>
              <label className="field-label" htmlFor="capture-details">Details <span className="optional-label">Optional</span>
                <textarea id="capture-details" maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} />
              </label>
              <label className="field-label" htmlFor="capture-due-date">Due date <span className="optional-label">Optional · not a calendar time</span>
                <input id="capture-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
            </>
          )}
          {error && <p className="form-message" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : kind === "priority" ? "Add priority" : "Save task"}
          </button>
        </form>
      </section>
    </div>
  );
}

export function EndDaySheet({
  plan,
  priorities,
  nextDayPriorityCount,
  onClose,
  onSaved,
}: {
  plan: DailyPlan;
  priorities: Priority[];
  nextDayPriorityCount: number;
  onClose(): void;
  onSaved(): void;
}) {
  const { queueMutation } = useWorkspace();
  const [outcomes, setOutcomes] = useState<Record<string, string>>(() => Object.fromEntries(
    priorities.filter((priority) => priority.outcome).map((priority) => [priority.id, priority.outcome!]),
  ));
  const [carryForwardIds, setCarryForwardIds] = useState<string[]>([]);
  const [reflection, setReflection] = useState(plan.reflection ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateEndDayReview(priorities, outcomes, carryForwardIds, nextDayPriorityCount);
    if (!validation.ok) {
      setError(validation.reason === "outcomes-required"
        ? `Choose an outcome for ${validation.missingPriorityIds.length} remaining priority.`
        : validation.reason === "priority-limit"
          ? "Tomorrow already has three priorities. Remove one before carrying anything forward."
          : "Only partly done or not done priorities can be carried forward.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await queueMutation({
        entityType: "end_day",
        recordId: plan.id,
        expectedRevision: plan.revision,
        payload: {
          outcomes: priorities.map(({ id }) => ({ priority_id: id, outcome: outcomes[id] })),
          reflection: reflection.trim() || null,
          carry_forward: validation.carryForwardIds.map((sourceId) => ({
            source_priority_id: sourceId,
            new_priority_id: crypto.randomUUID(),
          })),
        },
      });
      onSaved();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The day could not be reviewed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="end-day-title">
        <div className="sheet-heading">
          <div><span className="eyebrow">DAY REVIEW</span><h2 id="end-day-title">End Day</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close day review">×</button>
        </div>
        <p className="sheet-intro">Choose what happened for each priority. Linked tasks are evidence; they never choose the outcome for you.</p>
        <form className="sheet-form" onSubmit={submit}>
          {priorities.map((priority) => {
            const outcome = outcomes[priority.id] ?? "";
            return (
              <fieldset className="review-priority" key={priority.id}>
                <legend>{priority.title}</legend>
                <label className="field-label" htmlFor={`outcome-${priority.id}`}>Outcome
                  <select id={`outcome-${priority.id}`} value={outcome} onChange={(event) => {
                    setOutcomes((current) => ({ ...current, [priority.id]: event.target.value }));
                    if (!['partly_done', 'not_done'].includes(event.target.value)) {
                      setCarryForwardIds((current) => current.filter((id) => id !== priority.id));
                    }
                  }}>
                    <option value="">Choose an outcome</option>
                    <option value="done">Done</option>
                    <option value="partly_done">Partly done</option>
                    <option value="not_done">Not done</option>
                    <option value="no_longer_relevant">No longer relevant</option>
                  </select>
                </label>
                {['partly_done', 'not_done'].includes(outcome) && (
                  <label className="check-option">
                    <input type="checkbox" checked={carryForwardIds.includes(priority.id)} onChange={(event) => {
                      setCarryForwardIds((current) => event.target.checked
                        ? [...current, priority.id]
                        : current.filter((id) => id !== priority.id));
                    }} />
                    <span>Suggest carrying this to tomorrow</span>
                  </label>
                )}
              </fieldset>
            );
          })}
          <label className="field-label" htmlFor="day-reflection">A note for today <span className="optional-label">Optional</span>
            <textarea id="day-reflection" maxLength={4000} value={reflection} onChange={(event) => setReflection(event.target.value)} />
          </label>
          {error && <p className="form-message" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving review…" : "Save review"}</button>
        </form>
      </section>
    </div>
  );
}

export function taskPayload(task: Task) {
  return {
    title: task.title,
    details: task.details,
    due_date: task.due_date,
    status: task.status,
    completed_at: task.completed_at,
    sort_order: task.sort_order,
  };
}
