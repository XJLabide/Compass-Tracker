"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/app/daily-components";
import { useWorkspace } from "@/app/app-workspace";
import { clearOwnerOfflineData } from "@/lib/offline/outbox";
import type { Appearance, Units } from "@/lib/daily/types";

export default function SettingsPage() {
  const router = useRouter();
  const { ownerId, profile, database, updateProfile } = useWorkspace();
  const [name, setName] = useState(profile.display_name ?? "");
  const [timezone, setTimezone] = useState(profile.timezone);
  const [units, setUnits] = useState<Units>(profile.units);
  const [appearance, setAppearance] = useState<Appearance>(profile.appearance);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const task = window.setTimeout(() => {
      setName(profile.display_name ?? "");
      setTimezone(profile.timezone);
      setUnits(profile.units);
      setAppearance(profile.appearance);
    }, 0);
    return () => window.clearTimeout(task);
  }, [profile]);

  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!timezone.trim()) {
      setError("Choose a timezone so each day keeps the right date.");
      return;
    }
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      setError("That timezone is not recognized. Use a value like Asia/Manila.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await updateProfile({ display_name: name.trim() || null, timezone: timezone.trim(), units, appearance });
      setMessage("Preferences saved. Changes made offline will sync when you reconnect.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const result = await response.json() as { error?: string; deleted?: boolean };
      if (!response.ok || !result.deleted) throw new Error(result.error ?? "Account deletion failed.");
      await clearOwnerOfflineData(ownerId, database ?? undefined);
      window.localStorage.removeItem(`compass:sync-lab-record:${ownerId}`);
      router.replace("/sign-in");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Account deletion is only available while online.");
      setBusy(false);
    }
  }

  return (
    <div className="daily-page settings-page">
      <PageHeader title="Settings" subtitle="Make Compass feel like your own" />
      <form className="settings-grid" onSubmit={savePreferences}>
        <section className="surface-card">
          <div className="surface-heading"><h2>Your profile</h2></div>
          <label className="field-label" htmlFor="profile-name">Name <span className="optional-label">Optional</span><input id="profile-name" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field-label" htmlFor="timezone">Timezone
            <input id="timezone" list="common-timezones" autoComplete="off" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            <datalist id="common-timezones"><option value="Asia/Manila" /><option value="America/Los_Angeles" /><option value="America/New_York" /><option value="Europe/London" /><option value="UTC" /></datalist>
          </label>
          <label className="field-label" htmlFor="units">Measurement units
            <select id="units" value={units} onChange={(event) => setUnits(event.target.value as Units)}>
              <option value="metric">Metric</option><option value="imperial">Imperial</option>
            </select>
          </label>
        </section>

        <section className="surface-card">
          <div className="surface-heading"><h2>Appearance</h2></div>
          <div className="appearance-options" role="group" aria-label="Appearance">
            {(["system", "light", "dark"] as const).map((option) => (
              <button className={appearance === option ? "appearance-choice is-selected" : "appearance-choice"} type="button" aria-pressed={appearance === option} key={option} onClick={() => setAppearance(option)}>
                <span>{option === "system" ? "◐" : option === "light" ? "☼" : "☾"}</span>
                {option === "system" ? "Device" : option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </section>

        {error && <p className="form-message" role="alert">{error}</p>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button>
      </form>

      <section className="surface-card account-danger-zone">
        <div className="surface-heading"><h2>Account and data</h2></div>
        <p className="section-intro">Deleting your account removes live Compass data, recovery snapshots, and synced sessions. A retained project backup may remain for up to 7 days; deletion tombstones are replayed before a restored project reopens.</p>
        <button className="button button-danger" type="button" onClick={() => setDeleteOpen(true)}>Delete account</button>
      </section>

      {deleteOpen && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteOpen(false); }}>
          <section className="sheet-panel" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-description">
            <div className="sheet-heading"><div><span className="eyebrow">ACCOUNT DELETION</span><h2 id="delete-account-title">Delete your Compass account?</h2></div><button className="icon-button" type="button" onClick={() => setDeleteOpen(false)} aria-label="Cancel account deletion">×</button></div>
            <p id="delete-account-description">This permanently deletes live plans, tasks, routines, and recovery snapshots. It cannot start while offline. Backups may persist for up to 7 days.</p>
            {error && <p className="form-message" role="alert">{error}</p>}
            <div className="sync-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => setDeleteOpen(false)}>Keep account</button>
              <button className="button button-danger" type="button" disabled={busy} onClick={() => void deleteAccount()}>{busy ? "Deleting…" : "Permanently delete"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
