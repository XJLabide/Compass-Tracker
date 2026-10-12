export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MutationStatus =
  | "pending"
  | "sending"
  | "failed"
  | "conflict"
  | "synced"
  | "resolved";

export type WorkspaceEntityType =
  | "profile"
  | "daily_plan"
  | "priority"
  | "priority_task_link"
  | "task"
  | "routine"
  | "routine_log"
  | "end_day"
  | "calendar_event"
  | "project"
  | "project_stage"
  | "project_task_link"
  | "life_area"
  | "goal"
  | "goal_update"
  | "goal_project_link"
  | "fitness_exercise"
  | "strength_program"
  | "strength_program_day"
  | "strength_program_exercise"
  | "strength_override"
  | "workout_log"
  | "fitness_activity_log"
  | "nutrition_target"
  | "meal_template"
  | "meal_template_item"
  | "meal_template_item_archive"
  | "meal_log"
  | "nutrition_checkin";

export type DailyEntityType = WorkspaceEntityType;

export interface QueuedMutation {
  id: string;
  recordId: string;
  expectedRevision: number;
  payload: JsonValue;
  entityType?: DailyEntityType;
  operation?: "upsert" | "link" | "unlink";
  createdAt: number;
  status: MutationStatus;
  serverRevision?: number;
  server?: { revision: number; payload: JsonValue };
  lastError?: string;
  resolution?: "keep-local" | "keep-server";
}

export interface CachedRecord {
  id: string;
  revision: number;
  payload: JsonValue;
  cachedAt: number;
}

export type MutationResult =
  | { status: "applied"; revision: number }
  | { status: "conflict"; server: { revision: number; payload: JsonValue } };

export interface MutationTransport {
  apply(mutation: QueuedMutation): Promise<MutationResult>;
}

const STORE_NAME = "mutations";
const CACHE_STORE_NAME = "cachedRecords";
const DATABASE_VERSION = 1;

export function openOutboxDatabase(
  ownerId: string,
  storageScope = "default",
): Promise<IDBDatabase> {
  if (!ownerId.trim()) return Promise.reject(new Error("An owner ID is required for offline storage"));
  const databaseName = `compass-offline:${storageScope}:${ownerId}`;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("by-status-created-at", ["status", "createdAt"]);
      request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: "id" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline storage"));
    request.onblocked = () => reject(new Error("Offline storage upgrade is blocked by another tab"));
  });
}

export async function cacheRecord(database: IDBDatabase, record: CachedRecord): Promise<void> {
  const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(CACHE_STORE_NAME).put(record);
  await Promise.all([requestResult(request), done]);
}

export async function readCachedRecord(
  database: IDBDatabase,
  id: string,
): Promise<CachedRecord | undefined> {
  const transaction = database.transaction(CACHE_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(CACHE_STORE_NAME).get(id) as IDBRequest<CachedRecord | undefined>;
  const result = await requestResult(request);
  await done;
  return result;
}

export async function listCachedRecords(
  database: IDBDatabase,
  idPrefix: string,
): Promise<CachedRecord[]> {
  const transaction = database.transaction(CACHE_STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(CACHE_STORE_NAME).getAll() as IDBRequest<CachedRecord[]>;
  const records = await requestResult(request);
  await done;
  return records.filter(({ id }) => id.startsWith(idPrefix));
}

export async function deleteCachedRecord(database: IDBDatabase, id: string): Promise<void> {
  const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(CACHE_STORE_NAME).delete(id);
  await Promise.all([requestResult(request), done]);
}

export function deleteOwnerOfflineData(
  ownerId: string,
  storageScope = "default",
): Promise<void> {
  if (!ownerId.trim()) return Promise.reject(new Error("An owner ID is required for offline storage"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`compass-offline:${storageScope}:${ownerId}`);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Unable to clear this account's offline data"));
    request.onblocked = () => reject(new Error("Close other Compass tabs before clearing offline data"));
  });
}

export async function clearOfflineData(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction([STORE_NAME, CACHE_STORE_NAME], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).clear();
  transaction.objectStore(CACHE_STORE_NAME).clear();
  await done;
}

export async function clearOwnerOfflineData(ownerId: string, activeDatabase?: IDBDatabase): Promise<void> {
  if (!ownerId.trim()) throw new Error("An owner ID is required for offline storage");
  if (activeDatabase) await clearOfflineData(activeDatabase);

  if (!indexedDB.databases) {
    await Promise.all(["default", "device-a", "device-b"].filter((scope) =>
      scope !== "default" || activeDatabase?.name !== `compass-offline:default:${ownerId}`,
    ).map((scope) => clearOwnerDatabase(ownerId, scope)));
    return;
  }

  const databaseNames = await indexedDB.databases();
  const ownerPrefix = "compass-offline:";
  const ownerSuffix = `:${ownerId}`;
  const otherNames = databaseNames
    .map(({ name }) => name)
    .filter((name): name is string => Boolean(name?.startsWith(ownerPrefix) && name.endsWith(ownerSuffix)))
    .filter((name) => name !== activeDatabase?.name);

  await Promise.all(otherNames.map(async (name) => {
    const scope = name.slice(ownerPrefix.length, -ownerSuffix.length);
    await clearOwnerDatabase(ownerId, scope);
  }));
}

async function clearOwnerDatabase(ownerId: string, scope: string): Promise<void> {
  const database = await openOutboxDatabase(ownerId, scope);
  try {
    await clearOfflineData(database);
  } finally {
    database.close();
  }
}

export async function enqueueMutation(
  database: IDBDatabase,
  mutation: QueuedMutation,
): Promise<void> {
  await runWrite(database, (store) => store.add({ ...mutation, status: "pending" }));
}

export async function listMutations(database: IDBDatabase): Promise<QueuedMutation[]> {
  const transaction = database.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<QueuedMutation[]>;
  const rows = await requestResult(request);
  await done;
  return rows.sort((left, right) => left.createdAt - right.createdAt);
}

export async function syncOutbox(
  database: IDBDatabase,
  transport: MutationTransport,
): Promise<{ synced: number; conflicted: number; failed: number }> {
  const queue = await listMutations(database);
  let synced = 0;
  let conflicted = 0;
  let failed = 0;

  for (const mutation of queue) {
    if (!["pending", "sending", "failed"].includes(mutation.status)) continue;

    await updateMutation(database, mutation.id, (current) => ({
      ...current,
      status: "sending",
      lastError: undefined,
    }));

    try {
      const result = await transport.apply(mutation);
      if (result.status === "applied") {
        synced += 1;
        await updateMutation(database, mutation.id, (current) => ({
          ...current,
          status: "synced",
          serverRevision: result.revision,
        }));
      } else {
        conflicted += 1;
        await updateMutation(database, mutation.id, (current) => ({
          ...current,
          status: "conflict",
          server: result.server,
        }));
      }
    } catch (error) {
      failed += 1;
      await updateMutation(database, mutation.id, (current) => ({
        ...current,
        status: "failed",
        lastError: error instanceof Error ? error.message : "Sync failed",
      }));
    }
  }

  return { synced, conflicted, failed };
}

export async function resolveConflict(
  database: IDBDatabase,
  mutationId: string,
  choice: "keep-local" | "keep-server",
  replacementMutationId?: string,
): Promise<QueuedMutation | undefined> {
  const current = await getMutation(database, mutationId);
  if (current.status !== "conflict" || !current.server) {
    throw new Error("Only a stored conflict can be resolved");
  }

  let retry: QueuedMutation | undefined;
  if (choice === "keep-local") {
    if (!replacementMutationId) {
      throw new Error("Keeping the local version requires a new mutation ID");
    }
    retry = {
      id: replacementMutationId,
      recordId: current.recordId,
      entityType: current.entityType,
      operation: current.operation,
      expectedRevision: current.server.revision,
      payload: current.payload,
      createdAt: Date.now(),
      status: "pending",
    };
  }

  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  store.put({ ...current, status: "resolved", resolution: choice });
  if (retry) store.add(retry);
  await done;
  return retry;
}

function runWrite(
  database: IDBDatabase,
  write: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const request = write(transaction.objectStore(STORE_NAME));
  return Promise.all([requestResult(request), done]).then(() => undefined);
}

async function getMutation(
  database: IDBDatabase,
  id: string,
): Promise<QueuedMutation> {
  const transaction = database.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const request = transaction.objectStore(STORE_NAME).get(id) as IDBRequest<QueuedMutation | undefined>;
  const mutation = await requestResult(request);
  await done;
  if (!mutation) throw new Error(`Mutation ${id} was not found`);
  return mutation;
}

async function updateMutation(
  database: IDBDatabase,
  id: string,
  update: (current: QueuedMutation) => QueuedMutation,
): Promise<void> {
  const current = await getMutation(database, id);
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).put(update(current));
  await done;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed"));
  });
}
