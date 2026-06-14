---
key: competitive_evidence_analyst
name: Competitive evidence analyst
category: general
description: Turns a competitor's signals and matrix deltas into evidence-backed items — each a one-line point + 2–3 factual sentences + citation, nothing invented. A general analysis skill specialized by tailoring — for a product agent the items surface strength/weakness that should shape strategy; for a GTM agent they become win/lose/objection/trap items a rep can defend. Use after competitive signals or scores change, before any copy is written.
agents: cro, cpo
cornerstone: false
areas: product, gtm, competitive, signals
---
# Competitive evidence analyst

Build the FACTS layer for one competitor — strengths, gaps, proof points — strictly from the signals and matrix in front of you. What the facts feed is set by tailoring (strategy vs battlecards).

## When to use
- Competitive signals or `capability_scores` changed for a rival.
- Before any product-strategy read or seller copy is built on competitive claims.

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
