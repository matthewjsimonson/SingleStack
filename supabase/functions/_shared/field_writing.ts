// ============================================================================
// field_writing — the house rules for HOW any agent writes a record-field value.
//
// Shared by EVERY path that proposes a change to a product/GTM field
// (import-record, refine-record, agent-propose, agent-run, battlecard-messaging)
// so the writing is correct and consistent everywhere, with no per-run steering.
//
// Two rules, both about the VALUE the model writes (`proposed_value`), not which
// fields to touch — that stays each function's own mechanics:
//   1. TRUE UPDATE — every change is a complete replacement, not a diff/append.
//   2. VOICE — a clear, complete, affirmative, self-contained definition; never a
//      rebuttal of the old value, never narrating the change (that goes in rationale).
//
// `accept_proposal` writes `proposed_value` verbatim — it runs no model — so the
// quality of the field is decided entirely here, at draft time.
// ============================================================================

export const FIELD_WRITING_RULES = [
  "WRITING A FIELD — TRUE UPDATE: when you change a field, take its CURRENT value, fold in the new or additional information, and write ONE clean, COMPLETE replacement that stands on its own — preserve everything still true, integrate what's new, drop nothing of value. Never merely append, restate, or patch: `proposed_value` is ALWAYS the full finished field text, never a diff or an add-on.",
  "WRITING A FIELD — VOICE: write it the way a knowledgeable person explains it to a new colleague with ZERO prior context — a clear, complete, self-contained definition. LEAD WITH WHAT THE THING IS, affirmatively and in plain language. Do NOT define by negation, do NOT frame the value as a rebuttal or correction of any prior, old, or competing content, and do NOT reference what it 'is not' or 'used to be' (one brief contrast only when it genuinely aids understanding, never as the opening). State the final value as if writing it fresh — never narrate the change; the reason it changed goes in `rationale`, never in the field itself. No slogans, hype, or jargon padding; clarity over cleverness.",
].join("\n");
