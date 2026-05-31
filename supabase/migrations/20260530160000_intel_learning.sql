-- ============================================================================
-- Learning from ratification — the review queue + distilled lessons.
-- Plain English: accept/edit/reject is a 1-bit signal — too thin to learn from.
-- This adds two things:
--   • intel_updates — a REVIEW QUEUE. High-judgment synthesis deltas (new theme,
--     escalate, merge, decay, restate) no longer auto-apply; they queue here.
--     A human gives a verdict (accept/edit/reject) PLUS context: a free-text
--     rationale and reason tags. That verdict+context is the learning corpus.
--   • agent_lessons — distilled, CURATABLE preferences derived from that corpus
--     ("don't open a GTM theme from a single call"). Active lessons are injected
--     into the next synthesis prompt AND shown in the UI, where each can be
--     dismissed — so the human corrects what the system learned.
--
-- Low-judgment maintenance (attaching evidence, momentum) still auto-applies;
-- only judgment calls queue. Additive; nothing existing changes shape.
-- ============================================================================

-- ---- intel_updates: the review queue + the judgment record ------------------
create table intel_updates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),

  scope         text not null default 'synthesis',  -- which engine proposed it (room to grow)
  kind          text not null,                       -- new_theme | escalate | merge | decay | restate
  theme_id      uuid references signal_themes (id) on delete set null,  -- target (null for new_theme until applied)
  payload       jsonb not null,                      -- the proposed change (title/summary/state/merge ids/signal ids…)
  summary       text,                                -- one-line human-readable description of the proposed change

  status        text not null default 'pending',     -- pending | accepted | edited | rejected
  rationale     text,                                -- the human's CONTEXT (the teaching)
  reason_tags   text[] default '{}',                 -- quick tags: evidence_thin | wrong_lens | not_actionable | tone | duplicate | other
  edited_payload jsonb,                              -- when status=edited, what the human changed it to
  decided_by    text,                                -- who acted
  decided_at    timestamptz,

  constraint intel_updates_status_shape check (status in ('pending','accepted','edited','rejected')),
  constraint intel_updates_kind_shape check (kind in ('new_theme','escalate','merge','decay','restate'))
);

comment on table intel_updates is 'Review queue for high-judgment synthesis deltas. Human verdict (accept/edit/reject) + rationale + reason_tags is the learning corpus that distills into agent_lessons.';

create index intel_updates_org_id_idx on intel_updates (org_id);
create index intel_updates_status_idx on intel_updates (status);
create index intel_updates_theme_id_idx on intel_updates (theme_id);
create index intel_updates_created_at_idx on intel_updates (created_at desc);

alter table intel_updates enable row level security;
create policy intel_updates_org_isolation on intel_updates
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());

-- ---- agent_lessons: distilled, curatable preferences -----------------------
create table agent_lessons (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  scope         text not null default 'synthesis',  -- which engine this lesson guides
  lesson        text not null,                       -- the preference, in plain language
  status        text not null default 'active',      -- active | dismissed
  derived_count integer not null default 1,          -- how many feedback items support it
  source        text not null default 'distilled',   -- distilled | human (a human can add one directly)

  constraint agent_lessons_status_shape check (status in ('active','dismissed'))
);

comment on table agent_lessons is 'Distilled, human-readable preferences derived from intel_updates feedback (or added by a human). Active lessons are injected into the synthesis prompt and shown in the Learning panel; dismissing one corrects what the system learned.';

create index agent_lessons_org_id_idx on agent_lessons (org_id);
create index agent_lessons_scope_status_idx on agent_lessons (scope, status);

alter table agent_lessons enable row level security;
create policy agent_lessons_org_isolation on agent_lessons
  for all using (org_id = public.current_org_id()) with check (org_id = public.current_org_id());
