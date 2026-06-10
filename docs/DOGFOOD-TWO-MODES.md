# Dogfood — two user modes

The platform serves two very different users. Walk it as **both**, top to bottom,
and log what breaks or feels wrong in `DOGFOOD-FINDINGS.md` (one row per finding).

**Prereq:** Settings → Workspace → **Load SingleStack workspace**. The seed now
populates a company whose product *is built and being sold* — battle cards,
messaging, competitors + scores, accounts → usage → PQLs, and a shipped epic with
a scored outcome — so both modes have real content.

---

## Mode A — the OPERATOR (makes intelligence)
PMs, founders, strategists running the loops. They produce; they tolerate the machinery.

1. **Sense** — `/signals`: Product & GTM tabs show real signals; `/market`,
   `/competitive` › Signal feed, `/frontier`. Log a signal; confirm it lands.
2. **Decide** — `/strategy`: themes bucketed; **Synthesize**; open a theme for
   provenance. `/gtm-strategy` mirrors it for GTM.
3. **Build** — push a theme → epic → Ship. Confirm the initiative spawns.
4. **Learn** — `/strategy` › **Outcomes**: the shipped epic has a **hit** and a
   **watching** outcome. Declare a new one; **Check now**; resolve; confirm a
   `Outcome …` signal appears back in `/signals`.
5. **Govern** — Settings › **Review & autonomy**: flip **Records → Autonomous**,
   run an agent proposal on a record → it auto-ratifies (no queue). Flip back.

**Operator question to answer:** does each loop close, and is the "so what"
obvious at every step?

---

## Mode B — the SELLER (consumes finished info)
Sales, SE, CS, field marketing — or a founder in sell-mode. The product is **built**;
they need *what to say*, packaged. They should **never** have to touch signals.

1. **Battle cards** — `/competitive` › **Competitors** → open Productboard /
   Crayon / Klue → the cards are populated (why we win/lose, objections, traps,
   proof). *Could a rep walk into a call with this?* Is it findable without
   knowing the competitive module exists?
2. **Messaging** — the GTM record carries value prop, **message pillars**,
   proof points, objection handling. *Is there a clean place to GET the messaging
   for a persona, or is it buried in a record editor meant for editing?*
3. **Who's ready to buy** — `/pql` (Go-to-market › Qualified leads): Acme
   (expansion), Globex / Soylent (qualified), Umbrella (at-risk). Open one →
   evidence + **Draft outreach**. *Does this read like a seller's desk?*
4. **Signal Profile** — `/competitive` › **Signal profile**: "our place in the
   market," HITL. *Useful as a one-pager a seller could quote?*

**Seller question to answer (the important one):** the product is built — can this
user get **ready-to-use battle cards and messaging** without producing or reading
a single signal? Today the answer is *partly* — the assets exist but have no
consumer home; they're scattered across the competitive drill-down and a record
editor. **That gap is the next build: a Seller's surface (Enablement) that
packages battle cards + messaging as "here's what to say."**
