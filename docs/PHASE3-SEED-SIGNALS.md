# Phase 3 Kickstart — seed signals + the first real connectivity test

This is the "bring the world in" starter pack for the dogfood. Two parts:
1. **What we learned testing the G2 connection live** (a real connectivity
   finding — log it, it's exactly the kind of signal the product is for).
2. **Ready-to-log seed signals** — market, competitive, and product/GTM — so
   synthesis has real material the moment you're at your computer.

> How to use: at `/signals`, hit **+ Log signal** for each. The suggested
> lens (Product/GTM), origin (internal/external), and confidence are noted.
> A few are deliberately **contradictory** so you can watch honest confidence +
> disconfirmation work. Source any "G2/market" ones to a source named "G2".

---

## 1. First real connectivity test — what actually happened (LOG THIS)

I tried to pull competitive/market intel from the live **G2 MCP connection** to
auto-draft signals. Honest result:
- ✅ **Category/taxonomy data is reachable.** I pulled the real **"Product
  Management"** G2 category — our adjacent space — and its definition (idea mgmt,
  roadmapping, user-feedback, product analytics). Useful for positioning.
- ❌ **Product, review, and buyer-intent data was NOT reachable** on this
  connection. `list_products`, `show_product`, and review/intent endpoints
  returned empty / "not found" — the connection is **account-scoped** (a seller
  view of *owned* products) and our account doesn't own those products, so
  competitor ratings/reviews/intent aren't exposed.

**Why this matters (the dogfood lesson):** connectivity isn't binary —
"connected" can still mean "connected to a *slice*." A source's **scope and
permissions** are first-class. Our connectivity design must surface *what a
source can actually see*, not just on/off. → This is `CONNECTIVITY.md`'s "least
privilege & surface exactly what a source can access" principle, now validated
by real experience.

**Signals to log from this:**
- *(product · external · conf 0.8)* "A 'connected' source can expose only a
  slice of its data (G2: category data yes, competitor reviews/intent no, due to
  account scope). Sources need a visible 'what this can see' scope, not just a
  connected/disconnected toggle."
- *(gtm · external · conf 0.7)* "G2 defines our adjacent category as 'Product
  Management' (roadmapping + feedback + analytics). Buyers will slot us there by
  default — our positioning must actively break out of it ('not a PM tool, the
  learning layer between product & GTM')."
- *(product · external · conf 0.6)* "Buyer-intent + competitor-review data lives
  behind seller-scoped access. To use it we'd need our own G2 seller seat or a
  data-licensing path — a real cost/sequencing decision for the competitive
  module."

---

## 2. Seed signals — ready to log

### Market (external — the category & demand environment)
- *(gtm · external · 0.7)* "The 'Product Management software' category (per G2)
  is defined around roadmapping, feedback, and analytics — a crowded,
  well-understood space. Entering as 'another PM tool' = commodity. Entering as
  'compounding intelligence between product & GTM' = new category."
- *(gtm · external · 0.6)* "AI-native buyers increasingly expect tools to *learn*
  from their data, not just store it. 'Set up once and it gets smarter' is
  becoming table stakes in how AI software is evaluated."
- *(product · external · 0.6)* "MCP is emerging as the standard way to expose
  data/tools to AI apps. Betting on MCP-as-connector means new sources become
  'paste a URL' instead of 'build an integration' — a durable moat if we nail it."

### Competitive (external — the players)
- *(gtm · external · 0.7)* "Productboard / Aha! / Cycle own 'product management &
  feedback'; Dovetail owns research; Crayon / Klue own competitive intel. Each is
  a point solution. None connect product↔GTM as one learning layer — that gap is
  our wedge."
- *(gtm · external · 0.6)* "Incumbents (Aha!, Productboard) are bolting AI onto a
  feedback/roadmap core. Their AI summarizes; it doesn't *compound* or cross
  product↔GTM. Our risk: they close the gap with brand + distribution before we
  build trust."
- *(product · external · 0.5)* "Gong / Pendo are signal *sources* (calls, usage),
  not competitors. Ingesting them (vs competing) is the smarter play — be the
  brain on top of their data."

### Product (internal — what we believe about the product)
- *(product · internal · 0.8)* "Teams repeatedly lose the 'why' behind past
  decisions. Decision provenance (signal → decision → shipped) is a real,
  recurring pain we solve and others don't."
- *(product · internal · 0.7)* "The 'how' goes stale weekly as AI capabilities
  change — a build approach written a month ago is often already wrong. Grounding
  the 'How' in current capabilities is differentiated and timely."
- *(product · internal · 0.7)* "The intelligence map (semantic + topographic) is
  the thing people remember from a demo. It may be our single best wedge —
  worth disproportionate product investment."

### GTM (internal — what we believe about go-to-market)
- *(gtm · internal · 0.7)* "'Compounding intelligence' lands harder in
  conversation than 'AI for PM.' The category framing is doing real work."
- *(gtm · internal · 0.7)* "Founders, not PMs, feel the product↔GTM seam most —
  the economic buyer is likely the founder/CEO, not the Head of Product."

### Deliberately contradictory pair (to stress honest confidence)
- *(gtm · internal · 0.6)* "Buyers want a familiar anchor — comparing us to
  'a smarter Productboard' shortens the sales conversation."
- *(gtm · internal · 0.6)* "Anchoring to Productboard caps us as a feature, not a
  category — buyers who hear 'PM tool' stop listening before the map. We should
  refuse the comparison."
> Log BOTH. When synthesis clusters these, mark one as **contradicting** on the
> theme — watch the theme's honest confidence drop and the contested-ground
> signal appear. That's the anti-mediocrity engine earning its keep on our own
> positioning question.

---

## What good looks like after logging
~16 signals across both lenses, mixed origin/confidence, with at least one real
contradiction. Then **Synthesize** → you should get a handful of themes (e.g.
"category-creation vs PM-tool framing," "connectivity scope is first-class,"
"the map is the wedge"), at least one **bridge** (e.g. *product: the map wows*
↔ *gtm: buyers slot us as a PM tool* → *lead with the map to escape the
category*), and a contested theme on the Productboard-anchoring question.
