-- ============================================================================
-- Foundation setup — shared building blocks used by every Foundation table.
-- Plain English: before we make any tables, we turn on the UUID generator,
-- define the small set of fixed status values the records use, and create one
-- helper that answers "which org is the current user in?" so Row-Level
-- Security can fence every table to that org.
-- ============================================================================

-- UUID generation (gen_random_uuid). Present on Supabase, safe to re-run.
create extension if not exists pgcrypto;

-- Release status — reused by the product hub and by modules.
-- GA = generally available, BETA = beta, EA = early access.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'release_status') then
    create type release_status as enum ('GA', 'BETA', 'EA');
  end if;
end
$$;

-- Ratification status — whether a value is still a draft or has been ratified.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ratification_status') then
    create type ratification_status as enum ('drafted', 'ratified');
  end if;
end
$$;

-- current_org_id(): reads the caller's org from their JWT.
-- We look first for a top-level "org_id" claim, then fall back to
-- app_metadata.org_id. Returns NULL when absent (so RLS denies by default).
-- When you later add a memberships table, this is the single place to swap.
create or replace function public.current_org_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id',
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id'
    ),
    ''
  )::uuid
$$;

comment on function public.current_org_id() is
  'Returns the current request''s org_id from the JWT claims. Used by every Foundation RLS policy to scope rows to one org. Swap this body to use a memberships table later.';
