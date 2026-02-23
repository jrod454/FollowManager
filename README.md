# FollowManager

https://jrod454.github.io/FollowManager/

Discord follow-inventory dashboard with:
- Frontend: React + Vite, hosted on GitHub Pages
- Backend writer: one Supabase Edge Function (`sync-follow-manager-inventory`)
- Storage: one snapshot table (`follow_manager_inventory`) plus public read view (`follow_manager_inventory_public`)
- Auth: dashboard sign-in uses Supabase email/password

## Architecture

- A scheduled Edge Function syncs Discord webhook follow data every 5 minutes.
- The sync atomically replaces the snapshot table using `follow_manager_replace_inventory`.
- The web app reads from `follow_manager_inventory_public` directly via Supabase.
- Other websites can use the same public view to read the latest snapshot.

## Requirements

- Node.js 20+
- Supabase project with Auth enabled and an existing user
- Discord bot token with permission to read relevant guild data
- Supabase CLI (`supabase --version`) for deploys/migrations

## Environment Variables

Use `.env.example` at repo root and `web/.env.example` as your starting points.

Required for sync function runtime:
- `FOLLOW_MANAGER_DISCORD_BOT_TOKEN`
- `FOLLOW_MANAGER_DISCORD_GUILD_ID`
- `FOLLOW_MANAGER_DISCORD_API_BASE_URL` (optional, defaults to Discord v10)

Required for local function execution/testing:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Shared frontend config:
- `VITE_FOLLOW_MANAGER_SUPABASE_URL`
- `VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY`
- `VITE_FOLLOW_MANAGER_BASE_PATH` (default `/FollowManager/` for GitHub project pages)

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy web env file and fill values:

```bash
cp web/.env.example web/.env
```

3. Start web app:

```bash
npm run dev
```

## Database + Function Deploy

1. Copy root env file and fill values:

```bash
cp .env.example .env
```

2. Login and link:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

3. Apply database migrations:

```bash
supabase db push
```

4. Set function/runtime secrets:

```bash
supabase secrets set --env-file .env
```

5. Deploy sync function:

```bash
supabase functions deploy sync-follow-manager-inventory
```

## Scheduler Setup (5 Minutes)

The migration installs helper SQL function `public.follow_manager_upsert_sync_schedule()`.

Create vault secrets in SQL editor:

```sql
select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'follow_manager_project_url');
select vault.create_secret('YOUR_SERVICE_ROLE_JWT', 'follow_manager_service_role_jwt');
```

Then install/update the cron job:

```sql
select public.follow_manager_upsert_sync_schedule();
```

Cron job name: `follow-manager-sync-every-5m`

## Build and Test

```bash
npm run build
npm run test
```

## GitHub Pages

Frontend deployment is automated with GitHub Actions (`.github/workflows/deploy-pages.yml`).

Set repository variables/secrets used by the build:
- `VITE_FOLLOW_MANAGER_SUPABASE_URL`
- `VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY`
- `VITE_FOLLOW_MANAGER_BASE_PATH` (optional)

## Notes

- Snapshot reads are public by design through `follow_manager_inventory_public`.
