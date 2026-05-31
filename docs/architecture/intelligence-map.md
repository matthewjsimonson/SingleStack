# The Intelligence Map — a living battlefield you operate from

Status: **building (slice 1)** · Owner: SingleStack

## The idea
Every "AI for product/GTM" tool renders intelligence as a feed or table — flat,
one-thing-at-a-time, no sense of the whole. But our data is already a **graph**:
signals → themes → bridges → decisions → build items, linked by relationships
that carry *stance* (support vs contradict), *confidence*, *momentum*, *state*.
We render it as a living, force-directed **map** you are IN — a geospatial view
of the fronts you're fighting on. You navigate it, drill into nodes, trigger
actions from it, and your **agents are commanders** standing on it, pointing at
threats and opportunities.

Discipline (anti-"theater"): **every visual property encodes a real variable**,
and the map is where you DO things, not a screensaver.

## The graph (already in the schema)
- **Nodes:** signals · themes (product/gtm) · bridges · decisions · build items
- **Edges:** `theme_signals` (stance: support|contradict) · `bridges` (two legs)
  · `decision_evidence` · `initiatives.decision_id`

## Visual encoding (data → physics, nothing decorative)
| Variable | Encoding |
|---|---|
| node type | shape/color family (signal · theme · bridge · decision · build) |
| lens (product/gtm) | hue (accent vs violet) |
| honest confidence | node **size / mass** |
| momentum | pulse / subtle motion (accelerating pulses, fading dims) |
| lifecycle state | opacity (emerging→active→escalating bright; fading/dormant faint) |
| evidence stance | edge style: solid = supports, **red dashed = contradicts** (repulsive) |
| bridge | a thick cross-lens link; its weaker-leg conf is its strength |

## Agents as commanders (the layer that makes it alive)
Commanders are the org's standing intelligence, surfaced ON the map as callouts
pinned to nodes — and they're powered by the anti-mediocrity engine we built:
- **"Worth reconsidering"** (theme_misses) → a commander flag on a faded node
  that's regaining evidence: *"you dropped this; it's back."*
- **"Worth revisiting"** (decision_staleness) → a flag on a decision whose ground
  shifted.
- **Escalating / accelerating themes** → a commander marks a heating front.
- **Strong bridges** → a commander marks where two fronts connect.
Later: real agents (CPO/CRO-style) own regions and post their own callouts.

## Interaction
- **Navigate:** pan, zoom, drag nodes (force layout settles around them).
- **Drill in:** click a node → its detail (theme/bridge/decision pages we built).
- **Act from the map:** click a commander callout → take the action (reconsider,
  revisit, make a decision, find bridges).
- Later: drag two themes together → propose a bridge.

## Rendering
SVG + a light custom force simulation (repulsion + edge springs + centering),
no heavy deps. Fine for tens–hundreds of nodes at this data scale; crisp and on
-aesthetic. Canvas/WebGL only if scale demands it later.

## Slices
1. **Graph + living map** (this slice): assemble nodes/edges with encodings; SVG
   force map with pan/zoom/drag + click-to-drill; commander callouts from
   misses/staleness/escalation/strong-bridges. A new "Map" view in Signals.
2. **Act from the map:** inline actions on callouts; drag-to-bridge.
3. **Real agent commanders:** agents own regions, post callouts, run on triggers.
