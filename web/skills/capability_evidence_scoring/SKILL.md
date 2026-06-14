---
key: capability_evidence_scoring
name: Capability evidence scoring
category: general
description: Scores one named competitor 0–3 per capability strictly from cited evidence, omitting what the evidence doesn't address. A general analysis skill specialized by tailoring — for a product agent the scores expose strength/weakness that should move strategy; for a GTM agent they ground the matrix behind battlecards. Use when new competitive signals land, the matrix looks stale or guessed, or before a battlecard or strategy read is built on it.
agents: cro, cpo
cornerstone: false
areas: product, gtm, competitive, market, signals
---
# Capability evidence scoring

Keep the capability matrix honest: score each capability 0–3 for one competitor — but only where the evidence actually speaks. What you do with the scores is set by tailoring (product strategy vs GTM battlecards).

## When to use
- New competitive signals land for a rival.
- The matrix looks stale, guessed, or suspiciously complete.
- Before a battlecard or product-strategy read is built on the matrix.

**Tailored per agent:** a product agent reads the scores for real gaps that should move strategy; a GTM agent uses them to ground competitive claims. **Don't use** to write items or copy (→ Competitive evidence analyst / Competitive messenger).

## Inputs
- `signals` where `competitor_id = X` and per-competitor `signal_themes`.
- The current `capability_scores` matrix + its history.
- Market/review evidence (G2), with dates.

## Procedure — per capability, apply the scale strictly
- **0 — none:** no evidence, or a known gap.
- **1 — partial:** early / weak / mentioned only; a single soft mention is a 1, never higher.
- **2 — good:** shipped and corroborated.
- **3 — strong:** differentiated and multiply, independently confirmed.

1. **Cite or omit.** Name the signals behind each score. If evidence is silent on a capability, OMIT it — don't restate the old score, don't infer from brand.
2. **Weight recency.** An old launch note doesn't prove a current strength.
3. **Direction honesty.** If evidence contradicts the current score, say so.
4. **One-line rationale**, verifiable in 30 seconds.

## Output
Per scored capability: `score (0–3) · cited signals · one-line rationale`. Capabilities with no evidence listed explicitly as "no evidence" (not scored). Proposed for ratification.

## Worked example
> **Weak:** "Real-time collaboration: 3 (they're a big company)."
> **Strong:** "Real-time collaboration: 1 — one Aug-2025 changelog mention of 'presence indicators', no shipped co-editing in any review (S-141). Was 3; downgrading — brand-inferred, not evidenced."

## Reject / push back if
- A score exceeds 1 on a single mention.
- The matrix is filled where evidence is silent (guessed full).
- A score has no cited signal or no rationale.
- Old evidence is used to assert a current strength.
