import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheRecord,
  clearOfflineData,
  deleteOwnerOfflineData,
  enqueueMutation,
  listMutations,
  openOutboxDatabase,
  readCachedRecord,
  resolveConflict,
  syncOutbox,
  type JsonValue,
  type MutationTransport,
  type QueuedMutation,
} from "./outbox";

const databases: IDBDatabase[] = [];
const databaseNames: { ownerId: string; scope: string }[] = [];

async function createDatabase() {
  const ownerId = crypto.randomUUID();
  const scope = `test-${crypto.randomUUID()}`;
  const db = await openOutboxDatabase(ownerId, scope);
  databases.push(db);
  databaseNames.push({ ownerId, scope });
  return { db, ownerId, scope };
}

function mutation(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: crypto.randomUUID(),
    recordId: "record-1",
    expectedRevision: 1,
    payload: { title: "Local edit" },
    createdAt: 1,
    status: "pending",
    ...overrides,
  };
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(databaseNames.splice(0).map(({ ownerId, scope }) =>
    deleteOwnerOfflineData(ownerId, scope),
  ));
});

describe("offline mutation outbox", () => {
  it("replays queued work and marks it synced only after server acknowledgement", async () => {
    const { db } = await createDatabase();
    const queued = mutation();
    await enqueueMutation(db, queued);

    const transport: MutationTransport = {
      apply: async () => ({ status: "applied", revision: 2 }),
    };

    const result = await syncOutbox(db, transport);

    expect(result).toEqual({ synced: 1, conflicted: 0, failed: 0 });
    expect(await listMutations(db)).toMatchObject([
      { id: queued.id, status: "synced", serverRevision: 2 },
    ]);
  });

  it("retains both local and server versions when a revision conflict occurs", async () => {
    const { db } = await createDatabase();
    const queued = mutation();
    await enqueueMutation(db, queued);

    await syncOutbox(db, {
      apply: async () => ({
        status: "conflict",
        server: { revision: 3, payload: { title: "Remote edit" } },
      }),
    });

    const conflicted = await listMutations(db);
    expect(conflicted[0]).toMatchObject({
      id: queued.id,
      status: "conflict",
      payload: { title: "Local edit" },
      server: { revision: 3, payload: { title: "Remote edit" } },
    });

    const retry = await resolveConflict(db, queued.id, "keep-local", "new-mutation-id");
    expect(retry).toMatchObject({
      id: "new-mutation-id",
      expectedRevision: 3,
      payload: { title: "Local edit" },
      status: "pending",
    });
    expect((await listMutations(db)).find(({ id }) => id === queued.id)).toMatchObject({
      status: "resolved",
      resolution: "keep-local",
    });
  });

  it("keeps a failed mutation available for retry instead of dropping it", async () => {
    const { db } = await createDatabase();
    const queued = mutation();
    await enqueueMutation(db, queued);

    await syncOutbox(db, {
      apply: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(await listMutations(db)).toMatchObject([
      { id: queued.id, status: "failed", lastError: "network unavailable" },
    ]);
  });

  it("clears one device's local queue and cache without changing another device's copy", async () => {
    const ownerId = crypto.randomUUID();
    const scope = `test-${crypto.randomUUID()}`;
    const firstDevice = await openOutboxDatabase(ownerId, `${scope}-first`);
    const secondDevice = await openOutboxDatabase(ownerId, `${scope}-second`);
    databases.push(firstDevice, secondDevice);
    databaseNames.push({ ownerId, scope: `${scope}-first` }, { ownerId, scope: `${scope}-second` });
    const localMutation = mutation();
    const cached = { id: "record-1", revision: 1, payload: { title: "Cached" }, cachedAt: 1 };
    await enqueueMutation(firstDevice, localMutation);
    await cacheRecord(firstDevice, cached);
    await enqueueMutation(secondDevice, mutation({ id: "other-device" }));
    await cacheRecord(secondDevice, { ...cached, payload: { title: "Other device" } });

    await clearOfflineData(firstDevice);

    expect(await listMutations(firstDevice)).toEqual([]);
    expect(await readCachedRecord(firstDevice, cached.id)).toBeUndefined();
    expect(await listMutations(secondDevice)).toMatchObject([{ id: "other-device", status: "pending" }]);
    expect(await readCachedRecord(secondDevice, cached.id)).toMatchObject({ payload: { title: "Other device" } });
  });

  it("isolates cached data by account and preserves it for offline reads", async () => {
    const ownerId = crypto.randomUUID();
    const otherOwnerId = crypto.randomUUID();
    const scope = `test-${crypto.randomUUID()}`;
    const ownerDatabase = await openOutboxDatabase(ownerId, scope);
    const otherDatabase = await openOutboxDatabase(otherOwnerId, scope);
    databases.push(ownerDatabase, otherDatabase);
    databaseNames.push({ ownerId, scope }, { ownerId: otherOwnerId, scope });
    const record = { id: "daily-plan", revision: 4, payload: { title: "Today" }, cachedAt: 12 };

    await cacheRecord(ownerDatabase, record);
    expect(await readCachedRecord(ownerDatabase, record.id)).toEqual(record);
    expect(await readCachedRecord(otherDatabase, record.id)).toBeUndefined();
  });

  it("surfaces a stale edit between two separate device outboxes", async () => {
    const ownerId = crypto.randomUUID();
    const scope = `test-${crypto.randomUUID()}`;
    const firstDevice = await openOutboxDatabase(ownerId, `${scope}-first`);
    const secondDevice = await openOutboxDatabase(ownerId, `${scope}-second`);
    databases.push(firstDevice, secondDevice);
    databaseNames.push({ ownerId, scope: `${scope}-first` }, { ownerId, scope: `${scope}-second` });
    const firstEdit = mutation({ id: "device-a", payload: { title: "First device" } });
    const secondEdit = mutation({ id: "device-b", payload: { title: "Second device" } });
    await enqueueMutation(firstDevice, firstEdit);
    await enqueueMutation(secondDevice, secondEdit);

    let server: { revision: number; payload: JsonValue } = {
      revision: 1,
      payload: { title: "Original" },
    };
    const transport: MutationTransport = {
      apply: async (queued) => {
        if (queued.expectedRevision !== server.revision) {
          return { status: "conflict", server };
        }
        server = { revision: server.revision + 1, payload: queued.payload };
        return { status: "applied", revision: server.revision };
      },
    };

    await syncOutbox(firstDevice, transport);
    await syncOutbox(secondDevice, transport);

    expect(await listMutations(firstDevice)).toMatchObject([{ status: "synced", serverRevision: 2 }]);
    expect(await listMutations(secondDevice)).toMatchObject([
      { status: "conflict", payload: { title: "Second device" }, server: { revision: 2, payload: { title: "First device" } } },
    ]);
  });
});
