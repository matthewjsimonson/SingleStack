-- ============================================================================
-- capability_notes — the living knowledge of "what's buildable right now".
-- Plain English: the HOW of a build item is the AI's domain, and the best how
-- changes as tooling ships (a new AI coding capability, a framework release, an
-- internal code pattern). Rather than bake that into a prompt, it's DATA here:
-- each note is a capability the build-architect agent can ground its approach in
-- and cite. Configurable beyond the prompt: add/edit notes and the agent's How
-- changes with them. (Later, the connector runtime ingests these automatically
-- from changelogs/docs; for now they're curated rows.)
-- ============================================================================

create table capability_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  created_at  timestamptz not null default now(),

  title       text not null,            -- e.g. "Agentic coding in the IDE"
  content     text not null,            -- what it enables, in plain English
  category    text not null default 'ai_coding',  -- ai_coding | model | framework | internal | other
  source_url  text,                     -- where it came from (changelog/docs)
  observed_at timestamptz default now() -- recency, so the agent can prefer fresh capabilities
);

comment on table capability_notes is 'Curated/ingested capabilities the build-architect agent grounds the How in and cites. Data, not a prompt — add/edit notes to change how AI proposes builds.';

create index capability_notes_org_id_idx on capability_notes (org_id);
create index capability_notes_observed_at_idx on capability_notes (observed_at desc);

alter table capability_notes enable row level security;

create policy capability_notes_org_isolation on capability_notes
  for all
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());
