---
key: demo_persona_messaging
name: Persona messaging
category: gtm
description: Produces per-buyer messaging — for each persona, an outcome-led hook, the top objection handled, language drawn from real signals, and one ask. Use when messaging reads one-size-fits-all, when entering a new persona/segment, or when buyer-intent signals reveal language/objections the copy misses. Not for the product-level positioning (use Positioning sharpening) or competitive talk tracks (use Competitive messenger).
agents: cro
areas: gtm, market
connectors: G2
---
# Persona messaging

Tune the message to a specific buyer: the outcome they own, the objection that stops them, and the words they actually use.

## When to use
- Messaging reads one-size-fits-all.
- Entering a new persona or segment.
- Buyer-intent signals surface language/objections the copy misses.

**Don't use for:** the product-level positioning line (→ Positioning sharpening) or competitive objection-handling (→ Competitive messenger).

## Inputs
- GTM record fields `icp`, `industries`, `primary_persona` (+ added personas), `value_prop`.
- Buyer-intent and review signals (G2), `win_themes`, real objections from engagements.

## Procedure — per persona
1. **Outcome hook.** Open with what THIS persona is accountable for (a product leader ≠ an economic buyer ≠ an end user). Their outcome, not our features.
2. **Top objection.** Name the one thing that stops them; answer it in the next sentence.
3. **Their words.** Pull phrasing from a cited signal (review / intent / call), not invented language.
4. **One ask.** Close on the single next step that fits their stage.

## Output
Per persona: `Hook · Objection→answer · CTA · Sources` (the signals the language came from). Proposed for ratification.

## Worked example (Head of Product)
> **Hook:** "Stop your roadmap and messaging from drifting apart — agents keep both current from live signals; you ratify."
> **Objection:** "Another AI wrapper?" → "No — nothing changes without your sign-off; every change carries its evidence."
> **CTA:** "See a 10-minute teardown of your own record." — sources: G2-rev-88, intent-cluster-12.

## Reject / push back if
- The hook leads with our features instead of the buyer's outcome.
- Language is invented rather than drawn from a cited signal.
- More than one ask, or no ask.
- The same copy would fit any persona (not actually tuned).
