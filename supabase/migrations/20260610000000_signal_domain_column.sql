-- ============================================================================
-- Taxonomy cleanup — promote signal DOMAIN to a first-class column.
--
-- A signal has three axes: LENS (category: product|gtm|both), DOMAIN
-- (signals|competitive|market|capability|usage|…), and ORIGIN (internal|
-- external). Two were columns; DOMAIN lived buried in metadata.domain and was
-- filtered by scattered string literals across the app — the fraying behind the
-- recurring lens/routing bugs (the product board leaking GTM, PQL signals
-- mis-routing). This makes DOMAIN queryable + indexable + integrity-backed.
--
-- NON-BREAKING: a BEFORE trigger copies metadata.domain into the column, so
-- every existing writer (which sets metadata.domain) keeps working untouched;
-- new code can set the column directly. Readers migrate to the column over time.
-- ============================================================================

alter table signals add column if not exists domain text;

-- Backfill existing rows from metadata.
update signals set domain = metadata->>'domain'
  where domain is null and metadata ? 'domain';

-- Keep the column canonical on write: prefer an explicit domain, else fall back
-- to metadata.domain. (One-directional — we don't force metadata back in sync;
-- the column is the destination the codebase migrates toward.)
create or replace function public.signals_sync_domain()
returns trigger language plpgsql as $$
begin
  if new.domain is null and new.metadata ? 'domain' then
    new.domain := nullif(btrim(new.metadata->>'domain'), '');
  end if;
  return new;
end;
$$;

drop trigger if exists signals_sync_domain_trg on signals;
create trigger signals_sync_domain_trg
  before insert or update on signals
  for each row execute function public.signals_sync_domain();

create index if not exists signals_domain_idx on signals (org_id, domain);

comment on column signals.domain is 'First-class signal domain (signals|competitive|market|capability|usage|…), the canonical filter axis alongside category (lens) and origin. Auto-synced from metadata.domain by trigger for legacy writers; new code may set it directly.';
