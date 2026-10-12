# Compass Tracker

Compass is a private, mobile-first personal planning app. This repository starts with Phase 0 platform contracts and prototypes; it intentionally has no imported Personal Tracker data.

## Local development

Requirements: Node.js 20.9 or newer, npm, Docker Desktop, and the Supabase CLI dependency installed with this project.

```bash
npm install
npm run supabase:start
```

Copy the local API URL and publishable key printed by Supabase into `.env.local` (use `.env.example` as the template), then run:

```bash
npm run dev
```

Open `http://localhost:3000`. Local sign-up emails are captured by Supabase's local mail viewer at `http://127.0.0.1:54324`. Stop the local services with `npm run supabase:stop`.

Google sign-in stays disabled until a Google OAuth client has been configured. Email/password sign-in, reset, and the OAuth callback route are implemented for the local prototype. See [Platform contracts](docs/PLATFORM_CONTRACTS.md) for environment setup, data rules, and recovery boundaries.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run db:reset
npm run db:test
npm run build
```

The database test uses the Supabase local stack and pgTAP. The outbox test uses fake IndexedDB to exercise durable queue state and conflict resolution.
