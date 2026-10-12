"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  cacheRecord,
  enqueueMutation,
  listMutations,
  openOutboxDatabase,
  readCachedRecord,
  resolveConflict,
  syncOutbox,
  type JsonValue,
  type MutationStatus,
  type QueuedMutation,
} from "@/lib/offline/outbox";
import { createSupabaseMutationTransport } from "@/lib/offline/supabase-transport";
import { createClient } from "@/lib/supabase/client";
import { defaultProfile, loadProfile } from "@/lib/daily/repository";
import type { Appearance, DailyMutationInput, Profile } from "@/lib/daily/types";

interface WorkspaceContextValue {
  ownerId: string;
  profile: Profile;
  database: IDBDatabase | null;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  refreshKey: number;
  refreshQueue(): Promise<void>;
  notice: string;
  setNotice(message: string): void;
  queueMutation(input: DailyMutationInput): Promise<QueuedMutation>;
  syncNow(): Promise<void>;
  updateProfile(input: Partial<Pick<Profile, "display_name" | "timezone" | "units" | "appearance">>): Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace components must be inside AppWorkspace");
  return context;
}

export function AppWorkspace({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  const [database, setDatabase] = useState<IDBDatabase | null>(null);
  const [profile, setProfile] = useState<Profile>(() => defaultProfile(ownerId, Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState("");

  const refreshQueueState = useCallback(async (db: IDBDatabase) => {
    const rows = await listMutations(db);
    setPendingCount(rows.filter(({ status }) => status === "pending" || status === "sending").length);
    setFailedCount(rows.filter(({ status }) => status === "failed").length);
    setConflictCount(rows.filter(({ status }) => status === "conflict").length);
  }, []);

  const syncDatabase = useCallback(async (db: IDBDatabase) => {
    setSyncing(true);
    try {
      const result = await syncOutbox(db, createSupabaseMutationTransport(createClient()));
      await refreshQueueState(db);
      setRefreshKey((value) => value + 1);
      if (result.conflicted > 0) setNotice("A change from another device needs your review.");
      else if (result.failed > 0) setNotice("Changes remain saved on this device and will retry when the connection is available.");
      else if (result.synced > 0) setNotice("All queued changes are synced.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sync could not finish. Your local changes are retained.");
      await refreshQueueState(db);
    } finally {
      setSyncing(false);
    }
  }, [refreshQueueState]);

  const syncNow = useCallback(async () => {
    if (!database) return;
    await syncDatabase(database);
  }, [database, syncDatabase]);

  const refreshQueue = useCallback(async () => {
    if (database) await refreshQueueState(database);
  }, [database, refreshQueueState]);

  useEffect(() => {
    let active = true;
    let localDatabase: IDBDatabase | undefined;

    async function initialize() {
      const db = await openOutboxDatabase(ownerId);
      localDatabase = db;
      if (!active) {
        db.close();
        return;
      }
      setDatabase(db);
      await refreshQueueState(db);
      const supabase = createClient();
      try {
        const profile = await loadProfile(supabase, ownerId);
        await cacheRecord(db, {
          id: `profile:${ownerId}`,
          revision: profile.revision,
          payload: profile as unknown as JsonValue,
          cachedAt: Date.now(),
        });
        if (active) setProfile(profile);
      } catch {
        const cached = await readCachedRecord(db, `profile:${ownerId}`);
        if (active && cached) setProfile(cached.payload as unknown as Profile);
        if (active) setNotice(cached ? "Loaded preferences saved on this device." : "Profile preferences are cached until the connection returns.");
      }
      if (active && navigator.onLine) void syncDatabase(db);
    }

    void initialize().catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : "Local workspace storage is unavailable.");
    });

    const handleOnline = () => {
      setOnline(true);
      if (localDatabase) void syncDatabase(localDatabase);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const onlineTask = window.setTimeout(() => setOnline(navigator.onLine), 0);

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearTimeout(onlineTask);
      localDatabase?.close();
    };
  }, [ownerId, refreshQueueState, syncDatabase]);

  useEffect(() => {
    function applyAppearance(appearance: Appearance) {
      const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      const resolved = appearance === "system" ? (prefersLight ? "light" : "dark") : appearance;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    }

    applyAppearance(profile.appearance);
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () => {
      if (profile.appearance === "system") applyAppearance("system");
    };
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [profile.appearance]);

  const queueMutation = useCallback(async (input: DailyMutationInput) => {
    if (!database) throw new Error("Workspace storage is still starting");
    const mutation: QueuedMutation = {
      id: crypto.randomUUID(),
      recordId: input.recordId,
      entityType: input.entityType,
      operation: input.operation,
      expectedRevision: input.expectedRevision,
      payload: input.payload,
      createdAt: Date.now(),
      status: "pending",
    };

    await enqueueMutation(database, mutation);
    await refreshQueueState(database);
    setRefreshKey((value) => value + 1);
    setNotice(online ? "Saved on this device · syncing" : "Saved on this device · waiting to sync");
    if (online) await syncDatabase(database);
    return mutation;
  }, [database, online, refreshQueueState, syncDatabase]);

  const updateProfile = useCallback(async (
    input: Partial<Pick<Profile, "display_name" | "timezone" | "units" | "appearance">>,
  ) => {
    const expectedRevision = profile.revision;
    setProfile((current) => ({ ...current, ...input, revision: current.revision + 1 }));
    await queueMutation({
      entityType: "profile",
      recordId: ownerId,
      expectedRevision,
      payload: input,
    });
  }, [ownerId, profile.revision, queueMutation]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    ownerId,
    profile,
    database,
    online,
    syncing,
    pendingCount,
    failedCount,
    conflictCount,
    refreshKey,
    refreshQueue,
    notice,
    setNotice,
    queueMutation,
    syncNow,
    updateProfile,
  }), [ownerId, profile, database, online, syncing, pendingCount, failedCount, conflictCount, refreshKey, refreshQueue, notice, queueMutation, syncNow, updateProfile]);

  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceFrame>{children}</WorkspaceFrame>
    </WorkspaceContext.Provider>
  );
}

function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [syncOpen, setSyncOpen] = useState(false);
  const { profile, online, syncing, pendingCount, failedCount, conflictCount } = useWorkspace();
  const activeMore = ["/tasks", "/routines", "/history", "/goals", "/fitness", "/nutrition", "/settings", "/more"].some((path) => pathname.startsWith(path));

  const statusLabel = !online
    ? "Offline"
    : conflictCount > 0
      ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`
      : failedCount > 0
        ? `${failedCount} failed`
        : syncing
          ? "Syncing"
          : pendingCount > 0
            ? `${pendingCount} pending`
            : "Synced";

  const navigation = [
    { label: "Today", href: "/today", icon: "/icons/today.svg", activeIcon: "/icons/today-active.svg", active: pathname === "/today" },
    { label: "Home", href: "/home", icon: "/icons/home.svg", activeIcon: "/icons/home-active.svg", active: pathname === "/home" },
    { label: "Calendar", href: "/calendar", icon: "/icons/calendar.svg", activeIcon: "/icons/calendar-active.svg", active: pathname.startsWith("/calendar") },
    { label: "Projects", href: "/projects", icon: "/icons/projects.svg", activeIcon: "/icons/projects-active.svg", active: pathname.startsWith("/projects") },
    { label: "More", href: "/more", icon: "/icons/more.svg", activeIcon: "/icons/more-active.svg", active: activeMore },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="desktop-sidebar" aria-label="Primary navigation">
        <Link className="sidebar-brand" href="/today">
          <img src="/compass.svg" width="34" height="34" alt="" />
          <span>Compass</span>
        </Link>
        <div className="sidebar-section-label">YOUR DAY</div>
        <nav className="sidebar-nav">
          <Link className={pathname === "/today" ? "sidebar-link is-active" : "sidebar-link"} href="/today"><img width="20" height="20" src={navigation[0].active ? navigation[0].activeIcon : navigation[0].icon} alt="" />Today</Link>
          <Link className={pathname === "/home" ? "sidebar-link is-active" : "sidebar-link"} href="/home"><img width="20" height="20" src={navigation[1].active ? navigation[1].activeIcon : navigation[1].icon} alt="" />Home</Link>
          <Link className={pathname.startsWith("/calendar") ? "sidebar-link is-active" : "sidebar-link"} href="/calendar"><img width="20" height="20" src={navigation[2].active ? navigation[2].activeIcon : navigation[2].icon} alt="" />Calendar</Link>
        </nav>
        <div className="sidebar-section-label sidebar-section-spaced">YOUR SPACES</div>
        <nav className="sidebar-nav">
          <Link className={pathname.startsWith("/projects") ? "sidebar-link is-active" : "sidebar-link"} href="/projects"><img width="20" height="20" src={navigation[3].active ? navigation[3].activeIcon : navigation[3].icon} alt="" />Projects</Link>
          <Link className={pathname.startsWith("/goals") ? "sidebar-link is-active" : "sidebar-link"} href="/goals">Goals</Link>
          <Link className={pathname.startsWith("/fitness") ? "sidebar-link is-active" : "sidebar-link"} href="/fitness"><img width="20" height="20" src="/icons/fitness.svg" alt="" />Fitness</Link>
          <Link className={pathname.startsWith("/nutrition") ? "sidebar-link is-active" : "sidebar-link"} href="/nutrition"><img width="20" height="20" src="/icons/nutrition.svg" alt="" />Nutrition</Link>
          <Link className={pathname.startsWith("/tasks") ? "sidebar-link is-active" : "sidebar-link"} href="/tasks">Tasks</Link>
          <Link className={pathname.startsWith("/routines") ? "sidebar-link is-active" : "sidebar-link"} href="/routines">Routines</Link>
          <Link className={activeMore ? "sidebar-link is-active" : "sidebar-link"} href="/more">More</Link>
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-sync" type="button" onClick={() => setSyncOpen(true)}>
            <span className={online && !conflictCount && !failedCount ? "status-dot" : "status-dot status-dot-muted"} aria-hidden="true" />
            <span>{statusLabel}</span>
          </button>
          <Link className="sidebar-link" href="/settings">Settings</Link>
          <form action="/auth/sign-out" method="post"><button className="sidebar-link sidebar-sign-out" type="submit">Sign out</button></form>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="mobile-app-bar">
          <Link className="mobile-brand" href="/today"><img src="/compass.svg" width="25" height="25" alt="" />Compass</Link>
          <button className="mobile-sync" type="button" onClick={() => setSyncOpen(true)} aria-label={`Sync status: ${statusLabel}`}>
            <span className={online && !conflictCount && !failedCount ? "status-dot" : "status-dot status-dot-muted"} aria-hidden="true" />
            {conflictCount > 0 ? conflictCount : pendingCount + failedCount || ""}
          </button>
        </header>
        <main id="main-content" className="workspace-content">{children}</main>
      </div>

      <nav className="mobile-tab-bar" aria-label="Primary navigation">
        {navigation.map((item) => (
          <Link className={item.active ? "mobile-tab is-active" : "mobile-tab"} href={item.href} aria-current={item.active ? "page" : undefined} key={item.label}>
            <img src={item.active ? item.activeIcon ?? item.icon : item.icon} alt="" />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {syncOpen && <SyncCenter onClose={() => setSyncOpen(false)} />}
      <span className="sr-only" aria-live="polite">Appearance: {profile.appearance}</span>
    </div>
  );
}

function SyncCenter({ onClose }: { onClose(): void }) {
  const { database, online, syncing, pendingCount, failedCount, conflictCount, notice, syncNow, refreshKey, refreshQueue } = useWorkspace();
  const [rows, setRows] = useState<QueuedMutation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (database) setRows(await listMutations(database));
  }, [database]);

  useEffect(() => {
    const task = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(task);
  }, [refresh, refreshKey]);

  async function resolve(row: QueuedMutation, choice: "keep-local" | "keep-server") {
    if (!database) return;
    setBusyId(row.id);
    try {
      await resolveConflict(database, row.id, choice, choice === "keep-local" ? crypto.randomUUID() : undefined);
      await refresh();
      await refreshQueue();
      if (choice === "keep-local" && online) await syncNow();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="sync-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-dialog-title">
        <div className="sync-dialog-heading">
          <div><span className="eyebrow">DEVICE SYNC</span><h2 id="sync-dialog-title">Your changes</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close sync status">×</button>
        </div>
        <p className="sync-summary" role="status" aria-live="polite">
          {!online ? "Offline · local edits are saved on this device" : conflictCount ? `${conflictCount} changes need your choice` : failedCount ? `${failedCount} changes failed and can be retried` : pendingCount || syncing ? "Changes are waiting to sync" : "Everything is up to date"}
        </p>
        {notice && <p className="sync-notice">{notice}</p>}
        <button className="button button-primary" type="button" disabled={!online || syncing || !database} onClick={() => void syncNow()}>
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <div className="sync-change-list">
          {rows.length === 0 ? <p className="empty-copy">No queued changes.</p> : rows.slice(-12).reverse().map((row) => (
            <article className="sync-change" key={row.id}>
              <div className="sync-change-header">
                <strong>{row.entityType?.replaceAll("_", " ") ?? "Offline probe"}</strong>
                <span className={`sync-state sync-state-${row.status}`}>{statusLabel(row.status)}</span>
              </div>
              <p>{summarizeMutation(row.payload)}</p>
              {row.lastError && <small className="error-copy">{row.lastError}</small>}
              {row.status === "conflict" && row.server && (
                <div className="sync-conflict-values">
                  <div><small>This device</small><span>{summarizeMutation(row.payload)}</span></div>
                  <div><small>Server · revision {row.server.revision}</small><span>{summarizeMutation(row.server.payload)}</span></div>
                  <div className="sync-conflict-actions">
                    <button className="button button-secondary" type="button" disabled={busyId === row.id} onClick={() => void resolve(row, "keep-server")}>Keep server</button>
                    <button className="button button-primary" type="button" disabled={busyId === row.id} onClick={() => void resolve(row, "keep-local")}>Keep my edit</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
        <p className="sync-dialog-footnote">Deleting records waits for a connection. Conflicts keep both versions until you choose.</p>
      </section>
    </div>
  );
}

function statusLabel(status: MutationStatus) {
  const labels: Record<MutationStatus, string> = {
    pending: "Pending",
    sending: "Syncing",
    failed: "Failed",
    conflict: "Conflict",
    synced: "Synced",
    resolved: "Resolved",
  };
  return labels[status];
}

function summarizeMutation(payload: QueuedMutation["payload"]) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const value = payload as Record<string, JsonValue>;
    for (const key of ["title", "name", "reflection", "display_name", "note"]) {
      if (typeof value[key] === "string" && value[key]) return value[key] as string;
    }
    if (typeof value.value === "number") {
      return `${value.value}${typeof value.unit === "string" && value.unit ? ` ${value.unit}` : ""}`;
    }
    if (typeof value.status === "string") return value.status.replaceAll("_", " ");
  }
  return "A saved change";
}
