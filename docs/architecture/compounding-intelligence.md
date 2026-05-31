# Compounding intelligence — themes that live, accrue, and remember

Status: **building (slice 1)** · Owner: SingleStack · Extends `intelligence-and-ship.md`

## The gap this closes
Today `synthesize-signals` is **destructive**: every run does `DELETE all themes` →
regenerate. So intelligence has **no memory** — no "escalating for 12 weeks", no
momentum, no lifecycle. That's a re-runnable summarizer, not AI-native
intelligence. Gap 1 makes a theme a **living entity** that accretes evidence,
tracks a trajectory, and is maintained by a *standing* reconciliation process —
not a button that wipes and rebuilds.

## Principle
A theme has **identity, evidence that accretes over time, and a trajectory.**
Synthesis becomes **reconciliation**: the AI proposes *deltas* against stable
theme IDs (attach evidence / escalate / merge / decay / new), low-judgment deltas
auto-apply to keep intelligence fresh, high-judgment deltas are **proposals** the
human ratifies. The system gets smarter as the human curates (seeds Gap 5).

## Architecture (additive — house rules)

**`signal_themes` gains memory columns:**
- `state` — `emerging | active | escalating | steady | fading | dormant`
- `first_seen_at`, `last_evidence_at` — the spine of momentum
- `momentum` — `accelerating | steady | fading` (derived from evidence arrival rate)
- (`signal_ids uuid[]` stays, kept in sync, so the current UI keeps working)

**`theme_signals` — evidence as a temporal relationship (the key enabler).**
`(org_id, theme_id, signal_id, added_at, weight)`. Replaces the frozen array as
the source of truth: evidence *accrues*, momentum is computable, "12 signals · +3
this week" is real. Unique on `(theme_id, signal_id)`.

**`theme_events` — the trajectory (append-only memory).**
`(org_id, theme_id, kind, detail jsonb, actor, created_at)` where kind ∈
`created | evidence_added | escalated | state_changed | summary_updated |
merged_in | decayed | recommendation_changed`. This *is* the memory; the detail
timeline and "escalating Nw" read from here. Nothing is silently overwritten.

**Reconciliation engine (rewrite of `synthesize-signals`):**
Loads existing themes + their evidence + new/unattributed signals. Asks the model
for a **diff against stable theme IDs**:
`attach[{theme_id, signal_ids}]`, `state_changes[{theme_id, state}]`,
`merges[{into, from}]`, `decays[theme_id]`, `new_themes[...]`.
It **never deletes the set**. Applies deltas, writes `theme_events`, recomputes
momentum, keeps `signal_ids[]` synced. (Kills the destructive DELETE.)

## Anti-goals — do NOT let this regress to the mean (load-bearing)
A compounding, feedback-learning system has five failure modes that are
data-correct but make you *dumber*. These are explicit anti-goals:

1. **Conformity trap.** Learning from ratifications can converge on "propose what
   gets accepted" → suppresses the non-obvious correct call (a great PM's whole
   value). Mitigation: lessons must be about *evidence quality*, not "surface
   fewer contrarian themes"; the system surfaces its own MISSES (dismissed/faded
   themes that later proved right), and accept-rate is a diagnostic, never an
   optimization target.
2. **Evidence laundering / false confidence.** Confidence must come from
   INDEPENDENT corroboration, not signal *count*. 5 signals from one Gong call ≠
   3 from 3 independent sources. Near-duplicate signals must not inflate.
3. **Disconfirmation blindness.** Evidence must be able to CUT AGAINST a theme.
   A `stance` (supports | contradicts) on evidence; confidence weighs confirming
   vs disconfirming. A theme that survives disconfirmation is a real bet; one
   that only accretes agreement is a bubble.
4. **Stale conviction.** A decision/theme made on reality that has since been
   contradicted must be flagged for revisit, not left to look authoritative.
5. **Cold-start false confidence.** Three data points must not look like
   battle-tested conviction. Confidence must reflect corroboration breadth +
   age, and the UI must distinguish "emerging/thin" from "established".

The "honest confidence" mechanism (independence-weighted, disconfirmation-aware)
addresses 2+3 directly and is the core defense of the "push you to the best" thesis.

## Graduated HITL (the relationship, not button-press)
- **Auto-applied (low judgment):** attach a new signal to a clearly-matching
  theme, bump `last_evidence_at`, recompute momentum. Keeps the body of
  intelligence fresh continuously.
- **Ratified (high judgment):** new theme, escalation, merge/split, recommendation
  change → land as `proposals` the human accepts/edits/rejects.
- **Compounds:** every accept/reject on a delta is recorded → later grounds
  synthesis in this org's judgments. The human curates a living analyst, not a tool.

## UI (slice 2, after the engine)
- **Living theme cards:** momentum ▲/—/▼, lifecycle chip, "12 signals · +3 this
  week", "last evidence 2h ago".
- **Theme detail `/signals/themes/[id]`:** evidence timeline, confidence/momentum
  over weeks, the `theme_events` history, grouped supporting signals, curation
  controls, and "Make a decision →" (already built).
- **"Review intelligence updates"** replaces "Re-synthesize": the reconciliation
  diff shown as accept/edit/reject proposals.

## Slices
1. **Persistence + reconciliation engine** (this slice): migration
   (`theme_signals`, `theme_events`, lifecycle/momentum cols, backfill from
   `signal_ids[]`) + rewrite synthesis as non-destructive reconciliation that
   writes events and computes momentum. Graduated autonomy: maintenance
   auto-applies; new/escalate/merge are flagged for review.
2. **Living theme UI** — momentum cards + theme detail/trajectory + review surface.
3. **Learning from ratifications** (Gap 5) — ground synthesis in past accept/reject.
