# Living Records — dynamic, signal-driven, human-in-the-loop

Status: **built** (narrative + metric sides) · Owner: SingleStack
Surfaced during dogfood (finding #5). The narrative side shipped first; the metric
side is now wired through the same gate (migration
`20260730000000_metric_readings_through_gate`) — see "Metric side — BUILT" below.

## The principle (from the dogfood)

The Product and GTM records are **not static documents**. They are **living
records** that stay current as reality changes — driven by **signals and
releases** — but updates are **human-ratified on a controlled cadence**, not
automatic or constant. The record is an *output surface of the intelligence loop*,
not a separate doc. It breathes, on a gated cadence.

## What already exists (the narrative side — BUILT)

The foundation already supports records that update from signals via ratified
proposals, with full history:

- **`record_fields`** (`20260528000010`) — a field is `field_key` + `value text`,
  parented to a product or GTM record. The current value.
- **`field_revisions`** (`20260528000017`) — *every value a field has ever held*,
  in order, each linked to the `proposal_id` that produced it. A trigger records a
  revision on **every** change (hand-edit or accepted proposal), so the trail is
  never missed.
- **`accept_proposal()`** — the loop in one place: signals → proposal → human
  accepts → field value updates → ratification + revision recorded. This *is*
  "records move from signals, gated by a human."

So a **narrative** field (What it is, Positioning, Differentiation) already:
updates from signals (via a proposal a human accepts), keeps full history, and
never changes silently. That half of the vision is real.

## What's NOT built (the metric side — the real gap)

The dogfood example — **NPS, feature usage, broad product usage, shown
month-over-month** — needs things `field_revisions` does not provide:

1. **A typed METRIC field.** Today every field is `value text` (prose). A metric is
   **numeric + period + unit** (NPS = 42 for May; feature-X usage = 23% MoM), not a
   string. No metric field type exists.
2. **Time-series, not just history.** `field_revisions` answers "what prose did
   this field hold." A metric field needs "plot this number over months" — a trend,
   rendered as a trend, with deltas (↑/↓ MoM).
3. **Field↔signal binding.** A metric field should be *sourced from* an incoming
   signal stream (usage telemetry, NPS surveys, release events) and refresh on the
   gated cadence — there is no binding from a field to a signal/metric source today.

## Metric side — BUILT

The metric side now lands through the same gate. What shipped:

- **`field_kind`** on `record_fields` (`narrative` | `metric`) and a
  **`record_metrics`** time-series with enforced provenance (`20260601000000`).
- **`metric_latest()`** — latest value + MoM delta for the living display.
- **The gate** (`20260730000000`): `proposal_changes` carries a `metric_reading`
  kind (period, value, origin, source label/ref/id) under the SAME
  anti-fabrication CHECK as `record_metrics`; **`accept_proposal()`** applies it by
  upserting a provenance-bound `record_metrics` row linked to the ratifying
  proposal (a correction for the same period supersedes), and writes a
  ratification — identical to the narrative branch. Built on develop's
  conflict-aware/row-locking accept path, which is preserved verbatim. Verified
  end-to-end on Postgres (accept, supersede, narrative-field guard,
  unsourced-number rejection, narrative regression, and the drift→conflicted
  lock behavior).
- **UI**: `MetricField` offers *Add directly* (the human is their own gate) and
  *Propose for review* (routes a sourced reading into the queue); `ProposeDrawer`
  renders a `metric_reading` as a distinct, read-only "Metric reading" change.

Still open (next): binding a metric field to a **live signal/source stream** so
new-period readings are proposed automatically on the gated cadence, and teaching
the agent-propose/import functions to emit `metric_reading` changes from context.

## Original proposed shape (metric side) — as scoped before the build

Additive, mirroring the narrative loop so the gate/HITL stays identical:

- **A `field_kind`** on `record_fields`: `narrative` (today's default) | `metric`.
- **A `record_metrics` time-series** (or reuse `field_revisions` with a numeric
  column + `period` date): `record_field_id`, `period` (month), `value_num`,
  `unit`, `source` (signal/release/manual), `proposal_id`. One row per period.
- **Binding:** a metric field references a *metric source* (a signal type/query).
  New data for a period arrives as a **proposal** (`metric_update`) → human ratifies
  on the same gated cadence → a `record_metrics` row lands. Same HITL engine,
  numeric payload.
- **Render:** a metric field shows the latest value + MoM delta + a small trend;
  narrative fields render as today.

## Principles to hold

- **Same gate for both.** Narrative and metric updates both flow through
  proposal → human ratification. The record never changes silently; cadence is
  controlled, not real-time.
- **Additive.** `field_kind` defaults to `narrative`; every existing field and the
  whole accept_proposal loop are untouched.
- **History is sacred.** Narrative keeps `field_revisions`; metric keeps its
  period series. The record is auditable both ways.
- **The record is a surface of the loop, not a separate doc.** Signals/releases →
  proposal → ratify → the record reflects current reality.

## Open questions

1. Reuse `field_revisions` (add numeric + period columns) vs. a dedicated
   `record_metrics` table? (Leaning dedicated — cleaner time-series queries.)
2. Where do metric values originate first — manual entry with MoM history, or
   wired to a real signal/usage source from day one? (Likely manual-with-history
   first; binding later.)
3. Which fields become metrics on the Product/GTM records (NPS, usage, churn,
   acquisition…) and where do they live — a "Proof/Metrics" section on GTM, a
   health section on Product, or both?
4. Cadence control: per-field cadence, or one workspace-level "records update"
   ritual (e.g. monthly close)?
