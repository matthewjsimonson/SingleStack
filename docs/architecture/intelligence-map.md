# The Intelligence Map — a semantic, topographic strategy surface

Status: **redesign (curated projections)** · Owner: SingleStack
Supersedes the force-graph slice 1 as the primary model.

## The reframe
A force-directed graph positions nodes by *connection* — the axes mean nothing,
so it becomes a hairball at org scale (battle-tested: ~110 nodes = unreadable).
The right model: **position carries meaning.** Where a thing sits *is* what it
is — its lens, who it's for, how soon it matters, the bet it serves. A real
battlefield map is semantic: territory, high ground, front lines. That model
both expresses strategy AND fixes the hairball (semantic position is
deterministic and filterable — no simulation crisscross).

## Four orthogonal layers
1. **Position = two chosen axes (the meaning).** A node lands where its
   attributes put it.
2. **Territory = belonging.** The surface is shaded into regions (product line,
   team, owner, pillar) — "who/what it's for," made spatial.
3. **Elevation = intensity (the topography).** A contour/heat field: high ground
   = where high-confidence, accelerating intelligence concentrates; rifts =
   contested ground (contradictions) or thin evidence. This makes it *terrain*.
4. **Topology = connective tissue.** Bridges, contradicting edges, decision/build
   provenance drawn on top of positioned nodes.

## CURATED projections, not a freeform axis-picker (the core principle)
Freedom without guidance is a bad strategy. We do NOT ship X/Y dropdowns. We
ship a deliberate, small set of named **Views**, each answering ONE strategic
question. People PICK a View; they don't assemble one. Intentional > flexible.

Planned Views (each = a fixed axis pair + sensible territory + default filters):
- **Action Matrix** — X = Confidence, Y = Momentum. Act-now / watch / retire.
  *Buildable today (no new data).* The default for ICs and "what do I do now".
- **Situational** — X = Lens (Product↔GTM), Y = Horizon (Now→Next→Future).
  The strategist's map. *Needs `horizon`.*
- **Accountability** — X = Owner/Team, Y = Strategic pillar. Whose front, which
  objective. *Needs owner + objectives.*

Each View is opinionated: it knows its axes, its territory shading, what to
collapse (e.g. signals fold into themes at altitude), and what its quadrants
MEAN (labels: "Act now", "Contested", "Yesterday's truth").

## New dimensions to capture (additive, independently valuable)
These make intelligence *addressable* regardless of the map:
- **owner/team** on themes (and optionally signals) — "who it's for".
- **horizon** on themes — now | next | future.
- **objectives/pillars** — a small table themes & decisions link to — "what bet
  it serves".

## Agents help shape the terrain (the intelligent-interface layer)
Agents don't just live on the map — they CURATE the user's relationship to it:
- **Recommend the View**: "3 themes just crossed into high-confidence +
  accelerating — switch to the Action Matrix." The agent picks the projection
  that surfaces what matters now.
- **Propose dimension values**: suggest a theme's horizon, owner, or which
  objective it serves (human ratifies — same graduated HITL as everywhere).
- **Annotate territory**: flag a region heating up, a contested front, an
  ownership gap ("no one owns this escalating front").
This is the control/guidance that keeps freedom from becoming chaos: the system
has a point of view about where you should be looking and why.

## Anti-theater discipline (unchanged)
Every visual property encodes a real variable. The map is where you work and
drill in. Projections are few and meaningful. Agents guide, humans ratify.

## Slices
1. **Dimensions as data:** `horizon` + `owner` on themes; `objectives` table +
   theme/decision links. Agent proposals for these (reuse the proposal/HITL
   spine). No map change yet — dimensions are useful on their own.
2. **Curated projection engine + Action Matrix View** (buildable on existing
   data): deterministic positional layout, quadrant labels, territory shading,
   signal-collapse at altitude. Replace the force map as primary; keep force as
   an optional "constellation" view.
3. **Situational + Accountability Views** once dimensions land; the View picker.
4. **Elevation/contour field** (topography) — polish on correct position.
5. **Agent curation:** recommend-a-View, propose dimensions, annotate territory.
