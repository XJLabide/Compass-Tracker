export interface ProjectBoardStage {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
  is_complete: boolean;
}

export interface ProjectTask {
  id: string;
  title: string;
  status: "open" | "done" | "archived";
}

export interface ProjectTaskPlacement {
  stage_id: string;
  task_id: string;
  sort_order: number;
}

export function projectBoardColumns<TStage extends ProjectBoardStage, T extends ProjectTask>(
  projectId: string,
  stages: TStage[],
  placements: ProjectTaskPlacement[],
  tasks: T[],
): Array<{ stage: TStage; tasks: T[] }> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return stages
    .filter((stage) => stage.project_id === projectId && !stage.is_archived)
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))
    .map((stage) => ({
      stage,
      tasks: placements
        .filter(({ stage_id }) => stage_id === stage.id)
        .slice()
        .sort((left, right) => left.sort_order - right.sort_order || left.task_id.localeCompare(right.task_id))
        .map(({ task_id }) => taskById.get(task_id))
        .filter((task): task is T => task !== undefined),
    }));
}
