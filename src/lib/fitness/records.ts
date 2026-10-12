export interface LoggedStrengthSet {
  weight: number;
  reps: number;
}

export interface LoggedStrengthExercise {
  exercise_id: string;
  exercise_name: string;
  sets: LoggedStrengthSet[];
}

export interface StrengthWorkoutHistoryInput {
  id: string;
  completed_at: string;
  local_date?: string;
  exercises: LoggedStrengthExercise[];
}

export interface ExerciseHistoryRecord extends LoggedStrengthSet {
  estimated_one_rep_max: number;
}

export interface ExerciseHistorySession {
  workout_id: string;
  date: string;
  estimated_one_rep_max: number;
  records: ExerciseHistoryRecord[];
}

export interface ExerciseHistory {
  exercise_id: string;
  exercise_name: string;
  sessions: ExerciseHistorySession[];
}

export function estimateOneRepMax(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isInteger(reps) || reps < 1 || reps > 12) {
    return null;
  }
  return reps === 1 ? weight : roundToHundredth(weight * (1 + reps / 30));
}

export function buildExerciseHistory(workouts: StrengthWorkoutHistoryInput[]): ExerciseHistory[] {
  const ordered = [...workouts].sort((left, right) =>
    left.completed_at.localeCompare(right.completed_at) || left.id.localeCompare(right.id),
  );
  const histories = new Map<string, ExerciseHistory>();
  const bestWeightByRep = new Map<string, number>();

  for (const workout of ordered) {
    const date = workout.local_date ?? workout.completed_at.slice(0, 10);
    const dailySession = new Map<string, ExerciseHistorySession>();
    for (const exercise of workout.exercises) {
      const history = histories.get(exercise.exercise_id) ?? {
        exercise_id: exercise.exercise_id,
        exercise_name: exercise.exercise_name,
        sessions: [],
      };
      history.exercise_name = exercise.exercise_name;
      let session = dailySession.get(exercise.exercise_id);
      if (!session) {
        session = { workout_id: workout.id, date, estimated_one_rep_max: 0, records: [] };
        dailySession.set(exercise.exercise_id, session);
      }
      for (const set of exercise.sets) {
        const estimate = estimateOneRepMax(set.weight, set.reps);
        if (estimate === null) continue;
        session.estimated_one_rep_max = Math.max(session.estimated_one_rep_max, estimate);
        const recordKey = `${exercise.exercise_id}:${set.reps}`;
        const previousBest = bestWeightByRep.get(recordKey) ?? 0;
        if (set.weight > previousBest) {
          session.records.push({ ...set, estimated_one_rep_max: estimate });
          bestWeightByRep.set(recordKey, set.weight);
        }
      }
      histories.set(exercise.exercise_id, history);
    }
    for (const [exerciseId, session] of dailySession) {
      const history = histories.get(exerciseId);
      if (history && session.estimated_one_rep_max > 0) history.sessions.push(session);
    }
  }

  return [...histories.values()].sort((left, right) => left.exercise_name.localeCompare(right.exercise_name));
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}
