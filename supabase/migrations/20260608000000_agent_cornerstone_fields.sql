-- ============================================================================
-- Agent cornerstone, structured. The agent's identity used to be a single
-- freeform "base prompt" (agents.system_prompt). This adds four guided windows
-- that COMPOSE that prompt — identity, mandate, principles, voice — so setting
-- up an agent is staged and legible instead of one blank box.
--
-- All additive/nullable. system_prompt REMAINS the field the runtime reads; the
-- UI composes it from these four on save, so existing agents and every edge
-- function (agent-run, agent-chat, agent-propose) behave unchanged.
-- ============================================================================
alter table agents add column if not exists identity   text;
alter table agents add column if not exists mandate    text;
alter table agents add column if not exists principles text;
alter table agents add column if not exists voice      text;

comment on column agents.identity   is 'Cornerstone window 1 — who this officer is: role, seniority, domain. Composed into system_prompt.';
comment on column agents.mandate    is 'Cornerstone window 2 — what they own and are accountable for. Composed into system_prompt.';
comment on column agents.principles is 'Cornerstone window 3 — how they think and decide: priorities, tradeoffs. Composed into system_prompt.';
comment on column agents.voice      is 'Cornerstone window 4 — tone + guardrails (what they must not do). Composed into system_prompt.';
