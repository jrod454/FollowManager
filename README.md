# FollowManager

https://jrod454.github.io/FollowManager/

Discord follow-inventory dashboard with:
- Frontend: React + Vite, hosted on GitHub Pages
- Backend: one Supabase Edge Function (`follow-manager`)
- Auth: Supabase email/password, access restricted to an allowlisted user ID

## Architecture

- The frontend calls Supabase Functions directly using `@supabase/supabase-js`.
- The `follow-manager` function reads Discord webhooks/channels and returns grouped results.
- The API contract is intentionally minimal:
  - Success: follow inventory payload
  - Failure: `{ "error": "..." }`
- No cache, no `force` refresh flag, no diagnostics payload.

## Requirements

- Node.js 20+
- Supabase project with Auth enabled and an existing user
- Discord bot token with permission to read relevant guild data

## Environment Variables

Use `.env.example` at repo root as your starting point.

Required for function runtime:
- `FOLLOW_MANAGER_DISCORD_BOT_TOKEN`
- `FOLLOW_MANAGER_DISCORD_GUILD_ID`
- `FOLLOW_MANAGER_DISCORD_API_BASE_URL` (optional, defaults to Discord v10)
- `FOLLOW_MANAGER_ALLOWED_USER_IDS` (comma-separated Supabase user UUIDs)
- `FOLLOW_MANAGER_ALLOWED_ORIGINS` (comma-separated origins, include local + Pages origin, e.g. `https://jrod454.github.io`)

Shared (used by frontend and function runtime):
- `VITE_FOLLOW_MANAGER_SUPABASE_URL`
- `VITE_FOLLOW_MANAGER_SUPABASE_ANON_KEY`
- `VITE_FOLLOW_MANAGER_SUPABASE_FUNCTION_NAME` (default `follow-manager`)
- `VITE_FOLLOW_MANAGER_BASE_PATH` (default `/FollowManager/` for GitHub project pages)

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy `web` env file and fill values:

```bash
cp web/.env.example web/.env
```

3. Start web app:

```bash
npm run dev
```

This runs `vite` for `web/` on `http://127.0.0.1:5173` and always calls the live deployed `follow-manager` function.

## Manual Supabase Deploy

For deployment, you need Supabase CLI (`supabase --version`).

1. Copy root env file and fill values:

```bash
cp .env.example .env
```

2. Deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set --env-file .env
supabase functions deploy follow-manager
```

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
- `VITE_FOLLOW_MANAGER_SUPABASE_FUNCTION_NAME` (optional)
- `VITE_FOLLOW_MANAGER_BASE_PATH` (optional)
