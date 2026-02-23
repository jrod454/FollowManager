create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table if not exists public.follow_manager_inventory (
  webhook_id text primary key,
  guild_id text not null,
  guild_name text,
  destination_channel_id text not null,
  destination_channel_name text not null,
  source_guild_id text,
  source_guild_name text,
  source_channel_id text,
  source_channel_name text,
  refreshed_at timestamptz not null
);

create index if not exists follow_manager_inventory_destination_idx
  on public.follow_manager_inventory (destination_channel_name);

create index if not exists follow_manager_inventory_source_guild_idx
  on public.follow_manager_inventory (source_guild_name);

create index if not exists follow_manager_inventory_source_channel_idx
  on public.follow_manager_inventory (source_channel_name);

create or replace view public.follow_manager_inventory_public as
select
  webhook_id,
  guild_id,
  guild_name,
  destination_channel_id,
  destination_channel_name,
  source_guild_id,
  source_guild_name,
  source_channel_id,
  source_channel_name,
  refreshed_at
from public.follow_manager_inventory;

revoke all on public.follow_manager_inventory from anon, authenticated;
grant select on public.follow_manager_inventory_public to anon, authenticated;

create or replace function public.follow_manager_replace_inventory(
  snapshot_rows jsonb,
  snapshot_refreshed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  effective_refreshed_at timestamptz := coalesce(snapshot_refreshed_at, now());
begin
  if snapshot_rows is null or jsonb_typeof(snapshot_rows) <> 'array' then
    raise exception 'snapshot_rows must be a JSON array.';
  end if;

  truncate table public.follow_manager_inventory;

  if jsonb_array_length(snapshot_rows) = 0 then
    return 0;
  end if;

  insert into public.follow_manager_inventory (
    webhook_id,
    guild_id,
    guild_name,
    destination_channel_id,
    destination_channel_name,
    source_guild_id,
    source_guild_name,
    source_channel_id,
    source_channel_name,
    refreshed_at
  )
  select
    row.webhook_id,
    row.guild_id,
    row.guild_name,
    row.destination_channel_id,
    row.destination_channel_name,
    row.source_guild_id,
    row.source_guild_name,
    row.source_channel_id,
    row.source_channel_name,
    effective_refreshed_at
  from jsonb_to_recordset(snapshot_rows) as row(
    webhook_id text,
    guild_id text,
    guild_name text,
    destination_channel_id text,
    destination_channel_name text,
    source_guild_id text,
    source_guild_name text,
    source_channel_id text,
    source_channel_name text
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.follow_manager_replace_inventory(jsonb, timestamptz) from public;
grant execute on function public.follow_manager_replace_inventory(jsonb, timestamptz) to service_role;

create or replace function public.follow_manager_upsert_sync_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_job_id bigint;
  project_url text;
  service_role_jwt text;
  schedule_sql text := $schedule$
select net.http_post(
  url := (
    select rtrim(decrypted_secret, '/')
    from vault.decrypted_secrets
    where name = 'follow_manager_project_url'
    limit 1
  ) || '/functions/v1/sync-follow-manager-inventory',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'follow_manager_service_role_jwt'
      limit 1
    )
  ),
  body := '{}'::jsonb
);
$schedule$;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'follow_manager_project_url'
  limit 1;

  select decrypted_secret
  into service_role_jwt
  from vault.decrypted_secrets
  where name = 'follow_manager_service_role_jwt'
  limit 1;

  if project_url is null or btrim(project_url) = '' then
    raise exception 'Missing vault secret follow_manager_project_url.';
  end if;

  if service_role_jwt is null or btrim(service_role_jwt) = '' then
    raise exception 'Missing vault secret follow_manager_service_role_jwt.';
  end if;

  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'follow-manager-sync-every-5m'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'follow-manager-sync-every-5m',
    '*/5 * * * *',
    schedule_sql
  );
end;
$$;

revoke all on function public.follow_manager_upsert_sync_schedule() from public;

do $$
begin
  begin
    perform public.follow_manager_upsert_sync_schedule();
  exception
    when others then
      raise notice 'Skipping follow-manager sync schedule setup: %', sqlerrm;
  end;
end;
$$;
