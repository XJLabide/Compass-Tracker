"use client";

import { useCallback, useEffect, useState } from "react";
import {
  cacheRecord,
  clearOfflineData,
  enqueueMutation,
  listMutations,
  openOutboxDatabase,
  readCachedRecord,
  resolveConflict,
  syncOutbox,
  type CachedRecord,
  type JsonValue,
  type QueuedMutation,
} from "@/lib/offline/outbox";
import { createClient } from "@/lib/supabase/client";
import { createSupabaseMutationTransport } from "@/lib/offline/supabase-transport";

type ServerRecord = CachedRecord;
type SyncLabPayload = { title: string };
type DeviceScope = "device-a" | "device-b";

function titleFromPayload(payload: JsonValue): string | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const title = payload.title;
    if (typeof title === "string") return title;
  }
  return undefined;
}

export function SyncLab({ ownerId }: { ownerId: string }) {
  const [device, setDevice] = useState<DeviceScope>("device-a");
  const [database, setDatabase] = useState<IDBDatabase | null>(null);
  const [loadedDevice, setLoadedDevice] = useState<DeviceScope | null>(null);
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);
  const [serverRecord, setServerRecord] = useState<ServerRecord | undefined>();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("Loading this device's local queue…");
  const [busy, setBusy] = useState(false);

  const recordStorageKey = `compass:sync-lab-record:${ownerId}`;
  const deviceReady = database !== null && loadedDevice === device;

  const refreshMutations = useCallback(async (db: IDBDatabase) => {
    setMutations(await listMutations(db));
  }, []);

  const refreshServerRecord = useCallback(async (db: IDBDatabase) => {
    const id = window.localStorage.getItem(recordStorageKey);
    if (!id) {
      setServerRecord(undefined);
      setMessage("No shared record yet. Create the first revision.");
      return;
    }

    const { data, error } = await createClient()
      .from("sync_probe_records")
      .select("id,revision,payload,updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      const cached = await readCachedRecord(db, id);
      setServerRecord(cached);
      setMessage(cached ? "Offline · showing the last cached version" : error.message);
      return;
    }

    if (data) {
      const record: ServerRecord = {
        id: data.id,
        revision: data.revision,
        payload: data.payload as CachedRecord["payload"],
        cachedAt: Date.now(),
      };
      await cacheRecord(db, record);
      setServerRecord(record);
      setDraft(titleFromPayload(record.payload) ?? "");
      setMessage(`Server revision ${record.revision} · cached on this device`);
      return;
    }

    const cached = await readCachedRecord(db, id);
    setServerRecord(cached);
    setMessage(cached ? "Server record not found · showing cached data" : "No shared record yet. Create the first revision.");
  }, [recordStorageKey]);

  useEffect(() => {
    let active = true;
    let openedDatabase: IDBDatabase | undefined;

    async function loadDevice() {
      const db = await openOutboxDatabase(ownerId, device);
      openedDatabase = db;
      if (!active) {
        db.close();
        return;
      }
      setDatabase(db);
      await Promise.all([refreshMutations(db), refreshServerRecord(db)]);
      if (active) setLoadedDevice(device);
    }

    void loadDevice().catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Unable to load offline data");
    });

    return () => {
      active = false;
      openedDatabase?.close();
    };
  }, [device, ownerId, refreshMutations, refreshServerRecord]);

  async function queueEdit() {
    if (!database || !deviceReady || !draft.trim()) return;
    setBusy(true);
    try {
      let recordId = window.localStorage.getItem(recordStorageKey);
      if (!recordId) {
        recordId = crypto.randomUUID();
        window.localStorage.setItem(recordStorageKey, recordId);
      }

      await enqueueMutation(database, {
        id: crypto.randomUUID(),
        recordId,
        expectedRevision: serverRecord?.revision ?? 0,
        payload: { title: draft.trim() } satisfies SyncLabPayload,
        createdAt: Date.now(),
        status: "pending",
      });
      await refreshMutations(database);
      setMessage(`Saved locally from ${device}; server has not acknowledged it yet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue this edit");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!database || !deviceReady) return;
    setBusy(true);
    try {
      const result = await syncOutbox(database, createSupabaseMutationTransport(createClient()));
      await Promise.all([refreshMutations(database), refreshServerRecord(database)]);
      setMessage(`Sync complete · ${result.synced} saved · ${result.conflicted} conflicts · ${result.failed} failed`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed; the local edit is retained");
      await refreshMutations(database);
    } finally {
      setBusy(false);
    }
  }

  async function chooseConflict(mutation: QueuedMutation, choice: "keep-local" | "keep-server") {
    if (!database) return;
    try {
      await resolveConflict(
        database,
        mutation.id,
        choice,
        choice === "keep-local" ? crypto.randomUUID() : undefined,
      );
      await refreshMutations(database);
      setMessage(choice === "keep-local"
        ? "Local version queued against the latest server revision. Sync it to save."
        : "Server version kept. The local edit remains in recovery history.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to resolve this conflict");
    }
  }

  async function resetLocalQueues() {
    if (!database) return;
    setBusy(true);
    try {
      const otherDevice: DeviceScope = device === "device-a" ? "device-b" : "device-a";
      const otherDatabase = await openOutboxDatabase(ownerId, otherDevice);
      try {
        await Promise.all([clearOfflineData(database), clearOfflineData(otherDatabase)]);
      } finally {
        otherDatabase.close();
      }
      await refreshMutations(database);
      setServerRecord(undefined);
      setDraft("");
      setMessage("Local queues and cached snapshots cleared. The server record is unchanged; reload to cache it again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to clear local demo data");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<QueuedMutation["status"], string> = {
    pending: "Pending",
    sending: "Syncing",
    failed: "Failed · retry available",
    conflict: "Conflict · needs your choice",
    synced: "Synced",
    resolved: "Resolved",
  };

  return (
    <main className="lab-shell sync-shell">
      <section className="lab-card sync-card">
        <span className="eyebrow">PHASE 0 · OFFLINE CONTRACT</span>
        <h1>Sync lab</h1>
        <p className="lede">Queue a local edit, then sync it to the real Supabase revision check. No data is merged silently.</p>

        <div className="device-switch" aria-label="Choose a simulated device">
          {(["device-a", "device-b"] as const).map((scope) => (
            <button
              className={device === scope ? "device-button is-selected" : "device-button"}
              type="button"
              aria-pressed={device === scope}
              key={scope}
              onClick={() => setDevice(scope)}
            >
              {scope === "device-a" ? "Device A" : "Device B"}
            </button>
          ))}
        </div>

        <div className="sync-status" role="status" aria-live="polite">
          {deviceReady ? message : `Loading ${device === "device-a" ? "Device A" : "Device B"}'s local queue…`}
        </div>

        <label className="auth-fields sync-title" htmlFor="sync-title">
          Demo value
          <input
            id="sync-title"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="A local-only demo note"
          />
        </label>

        <div className="sync-actions">
          <button className="button button-secondary" type="button" disabled={busy || !deviceReady} onClick={queueEdit}>Save to this device</button>
          <button className="button button-primary" type="button" disabled={busy || !deviceReady} onClick={syncNow}>Sync now</button>
        </div>

        {deviceReady && serverRecord && (
          <div className="sync-record">
            <strong>Shared server value · revision {serverRecord.revision}</strong>
            <span>{titleFromPayload(serverRecord.payload) ?? "(empty)"}</span>
          </div>
        )}

        <div className="mutation-list" aria-label="Local mutation queue">
          {!deviceReady || mutations.length === 0 ? (
            <p className="empty-queue">No local edits on {device === "device-a" ? "Device A" : "Device B"}.</p>
          ) : mutations.map((mutation) => (
            <article className="mutation-row" key={mutation.id}>
              <div className="mutation-heading">
                <strong>{statusLabel[mutation.status]}</strong>
                <span>Based on revision {mutation.expectedRevision}</span>
              </div>
              <p>{titleFromPayload(mutation.payload) ?? "(empty)"}</p>
              {mutation.lastError && <p className="error-note">{mutation.lastError}</p>}
              {mutation.server && (
                <div className="conflict-versions">
                  <div><small>This device</small><span>{titleFromPayload(mutation.payload) ?? "(empty)"}</span></div>
                  <div><small>Server · revision {mutation.server.revision}</small><span>{titleFromPayload(mutation.server.payload) ?? "(empty)"}</span></div>
                  {mutation.status === "conflict" && (
                    <div className="sync-actions">
                      <button className="button button-secondary" type="button" onClick={() => void chooseConflict(mutation, "keep-server")}>Keep server</button>
                      <button className="button button-primary" type="button" onClick={() => void chooseConflict(mutation, "keep-local")}>Keep this device</button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>

        <div className="sync-footer">
          <span>Each device has a separate owner-scoped IndexedDB queue. Local reset keeps the server record.</span>
          <button type="button" onClick={() => void resetLocalQueues()} disabled={busy || !deviceReady}>Reset local demo</button>
        </div>
      </section>
    </main>
  );
}
