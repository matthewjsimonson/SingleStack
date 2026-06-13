-- ============================================================================
-- competitive_setup_runs — the GOVERNED DATA LAYER for guided competitive setup.
--
-- The wizard was stateless (matches in localStorage; the interview's only
-- governor was the model's own judgment). This table is the single source of
-- truth for an in-progress run, so:
--   • matches SURVIVE — server-side, across devices and sessions (resume is
--     a DB read, not a browser cache);
--   • questioning is GOVERNED — settings.max_questions caps how many the
--     interview may ask; the records are read first so it never re-asks what
--     they already answer;
--   • the rival pull is GOVERNED — settings.target_matches controls how many
--     competitors a run returns (not zero, not a hundred).
--
-- One OPEN run per (org, product line). Confirming the competitors flips it to
-- 'confirmed'; discarding flips it to 'discarded'. Everything is HITL — this
-- only persists the in-progress proposition, never writes competitors itself.
-- ============================================================================

create table competitive_setup_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  product_id  uuid references product_records (id) on delete cascade,   -- null = company-wide run
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  status      text not null default 'open',           -- open | confirmed | discarded
  context     jsonb not null default '{}'::jsonb,      -- the structured market context (product/who/industries/…)
  transcript  jsonb not null default '[]'::jsonb,      -- the drill-down Q&A so far
  picture     text,                                    -- the synthesized full picture
  matches     jsonb not null default '[]'::jsonb,      -- the candidate rivals — what survives
  settings    jsonb not null default '{}'::jsonb,      -- { max_questions, target_matches }

  constraint csr_status_shape check (status in ('open','confirmed','discarded'))
);

comment on table competitive_setup_runs is 'Governed in-progress state for the guided competitive setup: surviving matches, the interview transcript, and the run''s questioning/match budgets. One open run per (org, product line).';

-- One OPEN run per org+line (NULL product folds to a sentinel so company-wide
-- runs are also single). Confirmed/discarded runs are history and don't block.
create unique index csr_one_open_per_line on competitive_setup_runs
  (org_id, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
create index csr_org_idx on competitive_setup_runs (org_id, status);

create or replace function public.touch_competitive_setup_run() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger csr_touch before update on competitive_setup_runs
  for each row execute function public.touch_competitive_setup_run();

alter table competitive_setup_runs enable row level security;
create policy csr_org_isolation on competitive_setup_runs for all
  using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
