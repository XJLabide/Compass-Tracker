import type { LocalCalendarEvent, ExternalCalendar, ImportedCalendarEvent } from "@/lib/calendar/types";
import type { Goal, GoalProjectLink, GoalUpdate, LifeArea } from "@/lib/goals/types";
import type { Project, ProjectStage, ProjectTaskLink } from "@/lib/projects/types";
import type { Task } from "@/lib/daily/types";

export interface PlanningSnapshot {
  calendarEvents: LocalCalendarEvent[];
  externalCalendars: ExternalCalendar[];
  importedCalendarEvents: ImportedCalendarEvent[];
  projects: Project[];
  projectStages: ProjectStage[];
  projectTaskLinks: ProjectTaskLink[];
  tasks: Task[];
  lifeAreas: LifeArea[];
  goals: Goal[];
  goalUpdates: GoalUpdate[];
  goalProjectLinks: GoalProjectLink[];
}

export const emptyPlanningSnapshot: PlanningSnapshot = {
  calendarEvents: [],
  externalCalendars: [],
  importedCalendarEvents: [],
  projects: [],
  projectStages: [],
  projectTaskLinks: [],
  tasks: [],
  lifeAreas: [],
  goals: [],
  goalUpdates: [],
  goalProjectLinks: [],
};
