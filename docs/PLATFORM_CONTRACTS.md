# Compass Platform Contracts

**Status:** Phase 0 implementation baseline
**Repository:** [XJLabide/Compass-Tracker](https://github.com/XJLabide/Compass-Tracker)
**Data:** New blank namespace; do not import records from Personal Tracker.

## Decisions and pinned baseline

| Concern | Decision |
| --- | --- |
| App shape | Modular monolith; Next.js App Router PWA, organized by product domain |
| Runtime | Node.js 22.23.2 in the implementation environment; supported floor is 20.9 |
| Framework | Next.js 16.4.0, React/React DOM 19.3.0, TypeScript 5.x |
| Auth/data | Supabase Auth + PostgreSQL + RLS |
| SSR auth | `@supabase/ssr` 0.12.7, pinned because Supabase currently marks this package beta |
| Supabase client/CLI | `@supabase/supabase-js` 2.117.3; Supabase CLI 2.120.0 |
| Local mutation queue | IndexedDB; each client-generated mutation ID is stable across retries |
| Test tools | Vitest 5.0.3 and fake-indexeddb 6.2.5; Supabase local CLI/pgTAP for database policy tests |

The package lock is committed so installs resolve the tested graph. Recheck upstream compatibility and security advisories before dependency upgrades. Supabase documents `@supabase/ssr` as beta and recommends it for cookie-based SSR; Next.js 16 uses the `proxy.ts` convention, where earlier Next versions used `middleware.ts`.

## Environments and secrets

The repository configures a reproducible **local** Supabase stack in `supabase/config.toml`. The local stack uses a blank schema and no seed records. App settings belong in ignored `.env.local`; start from `.env.example`. Never commit service-role keys, database passwords, OAuth secrets, or provider credentials. Only a Supabase publishable key may be exposed to browser code.

The local config currently disables Studio, Realtime, Storage, Analytics, Edge Runtime, and the pooler to reduce first-run image downloads; enable a service when a later phase requires it. Postgres, Auth, API, and local email remain enabled for this prototype.

Create two distinct hosted projects in the approved Supabase organization and region before deploying data:

1. `compass-dev` for shared development and OAuth redirect testing.
2. `compass-prod` for production, with separate credentials and explicitly configured redirect URLs.

Neither hosted project is provisioned by this repository change. Project creation requires selecting the billing owner/organization and region. Do not connect production credentials to local development. Link the CLI to the intended project before remote schema operations, verify the project ref in the Supabase dashboard/CLI, and review every migration before applying it. This phase intentionally contains no legacy data import or production seed.

For local Google OAuth, provide `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the shell environment before starting Supabase, then enable the provider in the local config. Nonce validation stays enabled. Use separate OAuth credentials and callback allowlists for dev and production. Add `http://127.0.0.1:54321/auth/v1/callback` to the provider's authorized redirect URIs, and allow `http://localhost:3000/auth/callback` plus `http://127.0.0.1:3000/auth/callback` in Supabase Auth. The app callback validates the `next` path as a same-origin relative path before redirecting.

## Identity and session contract

- Email/password and Google are the selected sign-in methods. New Supabase identities start with a blank Compass namespace; Firebase credentials and UIDs are not imported.
- The browser client uses the publishable key and cookie-backed PKCE session provided by `@supabase/ssr`.
- `src/proxy.ts` calls `auth.getClaims()` to validate the access token and refresh expiring sessions. Server pages use verified claims for access decisions; they do not trust `getSession()` cookie contents.
- Email reset links return through `/auth/callback` and land on `/account/update-password`.
- OAuth and reset redirects stay on the current app origin. PWA standalone launch uses the same origin-based callback and returns into the installed app when the OS/browser associates the origin with the PWA.
- The local email server captures confirmation and password-reset messages at `http://127.0.0.1:54324`.

## Data, time, and synchronization

- Every product-owned record has an owner UUID tied to `auth.users`; RLS compares that owner to `auth.uid()`.
- The user's timezone is stored on their profile when profile storage is introduced. Calendar-day keys are `YYYY-MM-DD` in that timezone, never derived by truncating a UTC timestamp. Timed events are instants with explicit timezone context.
- Client-created records use stable UUIDs. Each mutation carries an idempotency UUID and the revision the edit was based on.
- The server mutation transaction locks the owned record, checks the expected revision, and atomically records the receipt plus result. A retry with the same mutation ID returns the original acknowledgement.
- A matching revision applies atomically and increments the revision. A stale revision returns the current server snapshot and a conflict status; clients preserve the local edit and the server snapshot. Do not silently merge or overwrite either version.
- `record_versions` stores the pre-edit snapshot for 30 days. Expiry cleanup is a scheduled operational task; it must be enabled and observed before production data uses this history.
- IndexedDB caches previously loaded data and pending mutations. UI must distinguish local pending, syncing, failed, conflicted, and synced states. Offline account deletion is rejected; it must not appear complete before the server confirms it.

## Deletion and recovery

- Account deletion first writes a durable deletion tombstone through a privileged server operation, then deletes the Supabase Auth user. Owner foreign keys cascade live records, history snapshots, and sync receipts. The tombstone has no user-facing read policy and remains available to suppress restored account data.
- Whole-project recovery is accepted with a 7-day maximum backup window as the current target. Confirm the selected Supabase plan's actual backup retention and cost before provisioning production; do not promise a longer restore point than the selected plan supplies.
- After a project restore, replay deletion tombstones before allowing users back in. The restore runbook must describe backup expiry and account-deletion behavior.
- Record-level 30-day recovery and project-level backup recovery are distinct safeguards.

## Provider boundaries

No external provider is selected in Phase 0. Integrations are server-side adapters; credentials never enter browser bundles.

- Assistant: `propose(request, relevantContext)` returns allowlisted proposals. The app shows a preview and requires explicit user confirmation before writes.
- Quotes and exchange rates: include value, currency, provider/source, `asOf`, and freshness (`fresh`, `stale`, `unavailable`). Manual values remain usable during failures.
- Calendar: list only selected calendars and read events only; external calendar data cannot mutate event sources.
- Reminders: schedule only after explicit opt-in; cancellation is supported.

## Phase 0 prototype evidence and known follow-up

- `supabase/migrations/20261012000000_platform_contracts.sql` demonstrates owner-scoped reads, revision-checked writes, idempotent mutation receipts, stale-write conflicts, pre-edit recovery snapshots, and a private tombstone table.
- `/sync-lab` lets two simulated device queues use the same owner-scoped probe record and the real revision-check RPC; it displays pending, failed, synced, and conflicted versions and offers explicit conflict resolution. `src/lib/offline/outbox.ts` owns account-partitioned IndexedDB reads/writes and durable queued mutations.
- `src/app/auth/*` implements password sign-in/sign-up/reset, Google OAuth initiation, PKCE callback exchange, and a protected server-rendered session check.
- `src/lib/time/local-date.ts` encodes timezone-local day boundaries. Provider interfaces live in `src/lib/providers/contracts.ts`.
- The local pgTAP suite covers owner isolation, revision changes, duplicate mutation replay, and stale-write conflicts. Vitest covers offline persistence, failure retention, timezone boundaries, owner separation, and a two-device conflict.
- Hosted dev/prod Supabase projects, Google OAuth credentials, production SMTP, production backup plan, and end-to-end real-provider Google auth remain follow-up setup steps. The repository code does not contain or invent those credentials.
