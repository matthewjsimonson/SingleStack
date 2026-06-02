-- ============================================================================
-- decisions: rationale + captured external input.
-- Plain English: a decision is made IN the theme drawer now — no bouncing to a
-- workspace. To do that in place it needs a free-text rationale ("what we
-- decided and why") and somewhere to hold input a colleague sends back (e.g.,
-- pasted from Slack/email) so it becomes part of the decision's context.
-- ============================================================================
alter table decisions add column if not exists rationale     text;
alter table decisions add column if not exists input_context text;

comment on column decisions.rationale is 'What was decided and why — captured in place when the operator makes the call.';
comment on column decisions.input_context is 'Input gathered from a colleague (e.g., via Slack/email) and pasted back as context for the decision.';
