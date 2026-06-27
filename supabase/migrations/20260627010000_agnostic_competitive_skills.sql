-- ============================================================================
-- Make the competitive skills GTM-motion-AGNOSTIC.
-- The library templates for the competitive analyst + messenger assumed a sales
-- motion ("seller copy", "a rep mid-call", "talk track for reps"). SingleStack
-- is product-, persona-, industry-, AND motion-agnostic: the GTM record defines
-- the motion (self-serve, product-led, sales-assisted, partner-led). These
-- instructions are injected into the battlecard agents, so the bias leaked into
-- generated output. Resync from web/skills/**/SKILL.md (source of truth).
-- Deterministic by key, scope='library' only (per-agent instances untouched).
-- Idempotent.
-- ============================================================================

update skills set
  description = 'Drafts competitive copy — summary, positioning angle, objection responses — strictly from items a human already ratified, adding no new facts, pitched for whatever GTM motion the record describes (self-serve, product-led, sales-assisted, partner-led). Use after the analyst''s items are ratified and the GTM team needs usable copy, or when a card''s positioning angle needs a voice pass. Not for producing or scoring the facts (use Competitive evidence analyst / Capability evidence scoring).',
  instructions = $md$
# Competitive messenger

Write the GTM-facing side of the battlecard — summary, positioning angle, objection responses — built only on ratified items, in the org's voice, usable in whatever motion the GTM record describes (an in-product comparison, a landing page, a sales conversation, a partner brief).

## When to use
- The analyst's competitive items are ratified and the GTM team needs usable copy.
- A card's positioning angle or objection responses need tightening or a voice pass.

**Don't use for:** producing or scoring the facts (→ Competitive evidence analyst / Capability evidence scoring). You add zero new facts.

## Inputs
- The ratified competitive items (the facts layer) for the competitor.
- GTM record fields `value_prop`, `proof_points`, the **GTM motion**, and the brand voice. Read the motion first — it decides who consumes this copy and where; make no assumption that there is a sales rep.

## Procedure
1. **Ratified items are floor and ceiling.** Use only what survived review; never re-introduce a rejected claim or add a fact of your own.
2. **Fit the motion.** Pitch the copy for how this org actually goes to market (from the GTM record) — a self-serve buyer reading a comparison page needs different framing than a partner brief or a sales conversation.
3. **Outcome framing.** Frame each win around what the buyer gets, not what we have.
4. **Objections honestly.** Concede the real strength, then the truthful reframe, then the proof.
5. **Plain voice.** Crisp, specific, sayable out loud; a subtle trap is a good question, not a gotcha.

## Output
A card: `Summary (lead paragraph) · Positioning angle · Objection→response (each with proof) · Sources (the ratified items each line rests on)`. Proposed for ratification.

## Worked example (positioning angle)
> **Weak:** "We crush the competition with superior AI."
> **Strong:** "Most teams we meet already have competitive intel — the gap is getting it into their own positioning. That's us: we don't just watch the market, we propose the record change and you approve it." (rests on ratified item CI-12)

## Reject / push back if
- A line introduces a fact not in the ratified set.
- A claim has no source item behind it.
- Copy assumes a motion the GTM record doesn't describe (e.g. a "talk track for reps" when the org is self-serve).
- Superlatives without proof ("crush", "best-in-class").
- A conceded competitor strength is spun instead of reframed.
$md$
 where key = 'competitive_messenger' and scope = 'library';

update skills set
  description = 'Turns a competitor''s signals and matrix deltas into evidence-backed items — each a one-line point + 2–3 factual sentences + citation, nothing invented. A general analysis skill specialized by tailoring — for a product agent the items surface strength/weakness that should shape strategy; for a GTM agent they become win/lose/objection/trap items the GTM team can defend. Use after competitive signals or scores change, before any copy is written.',
  instructions = $md$
# Competitive evidence analyst

Build the FACTS layer for one competitor — strengths, gaps, proof points — strictly from the signals and matrix in front of you. What the facts feed is set by tailoring (strategy vs battlecards).

## When to use
- Competitive signals or `capability_scores` changed for a rival.
- Before any product-strategy read or competitive copy is built on competitive claims.

**Tailored per agent:** product → "where they out-build us and what that means for strategy"; GTM → win / lose / objection / trap items. **Don't use** to write persuasive copy (→ Competitive messenger) or to score the matrix (→ Capability evidence scoring).

## Inputs
- `signals` where `competitor_id = X` and per-competitor `signal_themes`.
- The `capability_scores` matrix + its deltas.

## Procedure
1. **Evidence first.** Work only from the competitor's signals, themes, and matrix. An item you can't back with a cited signal or a clear matrix delta does not exist.
2. **Mine the deltas.** Where we lead → name the gap + what exposes it. Where they lead → name the real strength + what it implies (a strategy risk for product; an objection for GTM).
3. **Be conservative.** Fewer, well-evidenced items beat coverage. Never invent capabilities, pricing, quotes, or roadmap; if thin, say so.
4. **Point, then proof.** Title = the one-line takeaway; detail = 2–3 factual sentences + citation.

## Output
Items, each: `title (one line) · 2–3 factual sentences · cited signals/matrix delta · kind (strength|gap|objection|trap|proof)`. Proposed for ratification before any copy.

## Worked example
> **Weak:** "They're weak on integrations."
> **Strong:** "Gap — no native CRM sync. 3 G2 reviews (Jun–Sep 2025) cite manual export; matrix 'CRM sync' = 0 (S-90, S-93, S-97). Product read: our Salesforce sync is a durable wedge to harden. GTM read: discovery — 'how do competitive insights reach your CRM today?'"

## Reject / push back if
- An item has no cited signal or matrix delta.
- Capabilities, pricing, or quotes are invented to fill coverage.
- It's persuasive copy rather than a fact (that's the messenger's job).
- A real competitor strength is omitted because it's inconvenient.
$md$
 where key = 'competitive_evidence_analyst' and scope = 'library';
