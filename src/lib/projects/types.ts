export type ProjectStatus = "active" | "completed" | "archived";

export interface Project {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  sort_order: number;
  revision: number;
}

export interface ProjectStage {
  id: string;
  project_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_complete: boolean;
  is_archived: boolean;
  revision: number;
}

export interface ProjectTaskLink {
  id: string;
  project_id: string;
  task_id: string;
  stage_id: string;
  sort_order: number;
  active: boolean;
  revision: number;
}
