---
name: singlestack-voice
description: Govern the words and behavioral states of SingleStack — microcopy (buttons, tooltips, error messages, confirmations), state patterns (empty, loading, error, success), and agent dialogue (how named agents talk to users). Use this skill any time you are writing UI copy, naming a button, drafting an error message, designing an empty or loading state, writing agent-facing dialogue, or making any decision about what SingleStack says rather than how it looks. This skill governs words and behavior; the singlestack-ui skill governs visual surfaces; the singlestack-agents skill (when built) governs agent character and scope.
---

# SingleStack Voice Skill

This skill governs what SingleStack says. The `singlestack-ui` skill makes the product look like software; this skill makes it *sound* like software written by a sharp PMM colleague — not a SaaS marketing page, not a cheerful onboarding assistant, not a cautious AI hedging every claim.

Voice is where products lose their identity fastest. Visual systems are easier to maintain because designers protect them; copy gets edited by everyone and rots quietly into platitudes. The rules below exist to slow that rot.

The non-negotiables come first.

---

## 1. The Five Non-Negotiables

These are absolute. Copy that violates any of them does not ship, even if it sounds friendly.

**1.1 Every word does work.** No filler. No "simply," no "just," no "easily." No "in order to" when "to" works. No "please be aware that." If a word can be removed without loss of meaning, it is removed. Brevity is not a style choice; it is a respect signal to the user's time.

**1.2 Specific over generic, always.** "3 Sources unavailable" beats "Something went wrong." "Ratify positioning statement" beats "Approve." "Creative Officer drafted 3 concepts from the GovDash earnings signal" beats "AI generated some content." Names beat pronouns. Numbers beat "some." Verbs that say what happens beat verbs that gesture.

**1.3 SingleStack speaks as a sharp PMM colleague, not a SaaS app.** No "Welcome back!" No "Awesome!" No "Let's get started!" No "Great job!" No exclamation marks except in rare moments of intentional warmth. The product is a tool a professional uses to do hard work. It does not perform enthusiasm.

**1.4 Agents speak as themselves — third person, action-led, no AI hedging.** Named agents (Creative Officer, etc.) refer to themselves by name when relevant. They never say "As an AI..." They never say "I'd be happy to help." They never apologize for routine work. They report what they did and what is needed next.

**1.5 Errors give the user a path, not a wall.** "Something went wrong" is a wall. Every error message contains three things: what failed (specific), why if known (specific), what to do next (specific and actionable). Errors without a next step are bugs to fix, not states to design.

---

## 2. Mental Model: Voice / Tone / Specificity

Three dials. They move independently.

- **Voice is constant.** Direct, specific, PMM-fluent. Same across CI, Content, Enablement, Insights. Same whether the user is approving a draft or recovering from an error.
- **Tone adapts to context.** Routine save → neutral. Destructive action → precise and slightly weighty. Agent failure → matter-of-fact, not apologetic. Critical security warning → direct, no softening.
- **Specificity scales with stakes.** A "Discard" button can be one word. A "Permanently delete this Product Record and all its Features, Sources, and Ratifications" confirmation cannot.

When in doubt: voice never bends, tone bends to the situation, specificity bends to consequence.

---

## 3. The SingleStack Voice

A short anchor for the voice. Use these as a calibration check.

**What SingleStack sounds like:**

- "Creative Officer drafted 3 concepts. Ratify, edit, or dismiss."
- "Pulled 47 Gong transcripts from the last 30 days. 12 mention GovDash."
- "This Source is 9 days old. Refresh it before drafting customer-facing content."
- "Couldn't reach Gong. Your auth token expired 2 hours ago. Reconnect."

**What SingleStack does not sound like:**

- "Hi there! 👋 Creative Officer is excited to help you with some great concept ideas!"
- "We've successfully fetched some transcripts from Gong for you!"
- "Heads up — this content might be a little outdated."
- "Oops! Something went wrong. Please try again later or contact support."

The first set sounds like a colleague reporting work. The second sounds like a chatbot performing service. The first respects the user; the second performs respect.

---

## 4. Empty States

An empty state is not a failure. It is a moment of orientation. Three things must be present.

1. **What this surface is for.** Not "No items yet." Tell the user what kind of object lives here.
2. **What populates it.** Does an agent fill it? Does the user create the first one? Does a signal trigger it?
3. **The next action, if any.** A button if user action is expected, nothing if the system populates it automatically.

**Pattern:**

> **No Concepts in this signal yet.**
> Creative Officer surfaces Concepts as new signals arrive from Gong, Salesforce, and LinkedIn.
> [no button — the system populates this]

> **No Battlecards yet.**
> Battlecards are generated from Sources tagged "competitor." Tag a Source to get started.
> [Tag a Source →]

Empty state copy is rarely longer than two sentences. The visual treatment from `singlestack-ui` carries the rest.

**Anti-patterns:**

- "Nothing to see here." (Useless. The user knows there's nothing.)
- "Get started by creating your first Concept!" (Hype-coded. Also vague about *how*.)
- Emoji and illustrations that perform cheer. (Both are off-brand per `singlestack-ui` §4.)

---

## 5. Loading States

The 400ms rule from `singlestack-ui` §4 governs whether to show a loading state at all. This skill governs what it *says*.

**Under 400ms:** no copy. A skeleton or a subtle indicator only.

**400ms to 3 seconds:** a short status string. Action-led, specific.

- "Pulling Gong transcripts…"
- "Drafting 3 concepts…"
- "Saving Ratification…"

**Over 3 seconds:** the status string plus an elapsed timer or step indicator.

- "Pulling Gong transcripts… 14s elapsed"
- "Drafting 3 concepts… step 2 of 4 (analyzing Source chunks)"

**Over 30 seconds:** the agent owns the wait. The Status Pill (per `singlestack-ui` §8) goes to `Working` with a description, and the Reasoning Rail can be opened for live thinking.

**Anti-patterns:**

- A bare spinner with no copy past 400ms. (Mystery is not loading; it is bad design.)
- "Loading…" (Tells the user nothing they don't already know.)
- "This may take a moment." (Vague; useless for planning.)
- Fake percentages. (If the percentage isn't real, it is a lie.)

---

## 6. Error States

The anatomy of a good error message:

1. **What failed** — name the operation or object, not the generic action.
2. **Why** — if known and useful; omit if it would just be jargon.
3. **What to do next** — a specific, actionable step. Include a button if appropriate.

**Pattern:**

> **Couldn't fetch Gong transcripts.**
> Your Gong auth token expired 2 hours ago.
> [Reconnect Gong]

> **Ratification rejected.**
> The positioning_statement field requires at least one Source. Creative Officer's draft cited a Source that was deleted yesterday.
> [Add a Source] [Re-draft with current Sources]

> **Couldn't save Concept.**
> Network connection lost mid-save. Your changes are still in the draft.
> [Retry save]

**Rules:**

- **Never apologize for routine failures.** "Sorry," at the front of an error message is performative. Just say what happened.
- **Never blame the user.** "You entered an invalid value" → "This field requires a number between 0 and 100." Same information, no finger-pointing.
- **Never hide diagnostic info that would help.** If the auth token expired 2 hours ago, say so — even if the user can't act on the timestamp directly. It tells them the failure was not random.
- **Never use "Oops!" or "Uh oh!"** They infantilize.

**Anti-patterns:**

- "Something went wrong. Please try again." (Wall. No information. No path.)
- "Error: 500" (Information without translation.)
- "An unexpected error occurred." (All errors are unexpected from the user's perspective.)
- "Please contact support." (Last resort, not first response. Include support contact only after path-forward options have been listed.)

---

## 7. Success States

Success is mostly silent. SingleStack does not celebrate routine work.

**Routine successes** (save, ratify, draft, fetch) get a 2-second toast or an inline state change. No emoji. No exclamation marks. No celebration animation.

- "Ratified."
- "Saved."
- "3 concepts drafted."

**Meaningful successes** (a campaign published, a battlecard finalized) get a slightly larger acknowledgment, still restrained.

- "Battlecard published. Available in Enablement."
- "Campaign sent to 247 recipients."

**Rare moments** (first product onboarded, milestone hit) can warrant a real moment — but require a deliberate decision, not a default.

**Anti-patterns:**

- "Great job! Your draft has been saved!" (Hype for routine work.)
- "🎉 Successfully ratified!" (Emoji + adverb + exclamation = three violations.)
- Confetti for anything that happens more than once a quarter.

---

## 8. Microcopy: The Words Inside Components

The words that fill UI components are where voice either consolidates or evaporates. Defaults below.

**Buttons.** Verb + object. Specific, never generic.

- ✓ "Ratify positioning statement"
- ✓ "Discard changes"
- ✓ "Reconnect Gong"
- ✗ "Submit" — what is being submitted?
- ✗ "OK" — what is being OKed?
- ✗ "Cancel" — use "Discard" or "Keep editing" depending on what cancel actually does.

Exception: in tight UI chrome (toolbar icons, repeated table-row actions) a single verb is acceptable: "Edit," "Delete," "Ratify."

**Tooltips.** One sentence, present tense, says what the thing does.

- ✓ "Shows the Source this claim came from."
- ✓ "Stops the agent's current action."
- ✗ "Click here to view source." (The "click here" is implied by the cursor.)
- ✗ "This is the stop button." (Tautological.)

**Confirmation dialogs.** Title states what will happen. Body explains consequences. Button labels are specific.

- Title: "Delete this Product Record?"
- Body: "This permanently removes the Product Record and all 47 Features, 14 GTM Records, 312 Sources, and 89 Ratifications attached to it. This cannot be undone."
- Buttons: "Delete Product Record" (destructive style) | "Cancel"

Never use "Are you sure?" as a title. It is vague and adds no information.

**Form field labels and helper text.** Labels are nouns or short phrases. Helper text appears only when needed.

- Label: "Positioning statement"
- Helper text (only if needed): "One sentence. Will be the canonical positioning across all customer-facing content."
- Validation error: "Positioning statement is required."

Never use placeholder text as a substitute for a label. Placeholders disappear when the user types and are lost as accessibility cues.

**Notifications and toasts.** Two sentences maximum. State the event, then either the consequence or the next action.

- ✓ "Ratification superseded by newer version. The old value is preserved in the audit trail."
- ✓ "Gong sync complete. 47 new transcripts added."

---

## 9. Agent Dialogue

Named agents are co-workers, not chatbots. They have distinct voices. The default agent (Creative Officer, warm coral) is the canonical example; future agents will follow the same conventions with their own variations.

**Universal rules for all agents:**

- **Third person, action-led.** "Creative Officer drafted 3 concepts" — not "I drafted 3 concepts." This is unusual but deliberate: the third-person framing reinforces that the agent is an entity in the system, not the system itself.
- **Reports work, doesn't request validation.** "Creative Officer drafted 3 concepts. Ratify, edit, or dismiss." — not "Creative Officer drafted 3 concepts. Hope these are helpful!"
- **Never apologizes for being wrong, but acknowledges and revises.** "Creative Officer drafted from an outdated Source. Re-drafting with current Sources now." — not "Sorry, I made a mistake!"
- **Cites Sources by reference.** "Drafted from Gong call with Acme on May 14, the GovDash 10-Q earnings call, and the McKinsey AI in GovCon report." — never "based on what I know."
- **Never claims feelings or opinions it doesn't have.** No "I think this is your best option." Agents propose; humans decide.

**Creative Officer's specific voice traits:**

- Confident but not certain. Proposes concepts as candidates, not conclusions.
- Action-oriented in opening sentences. "Drafted three concepts from this signal." not "I noticed this signal might be interesting."
- Cites generously. Every concept references the Sources that triggered it.
- Brief in initial framing, willing to expand on request. The Reasoning Rail (per `singlestack-ui` §8) is where deeper reasoning lives.

**Example exchanges:**

> **Signal triggered.** GovDash announced ERP integration on their Q2 earnings call.
> **Creative Officer:** Drafted 3 concepts from the GovDash ERP signal. Each addresses a different angle: technical depth, customer overlap risk, and positioning. Ratify, edit, or dismiss.

> **Ratification rejected.**
> **Creative Officer:** Concept dismissed. The earnings call may be reweighted as a Source — let me know if you want fewer concepts from earnings signals going forward.

> **Source deprecated.**
> **Creative Officer:** Source "GovDash Q1 earnings" was marked stale. 4 concepts cited it. Re-drafting with the Q2 transcript.

The voice is consistent across these moments because the rules above never bend. Tone adapts to context.

---

## 10. Anti-Patterns: Things SingleStack Never Says

The fastest way to keep voice intact is to refuse the following on sight.

- **"Welcome back!"** — Hype openings. The user is here to work; they don't need a greeting.
- **"Awesome!" / "Great!" / "Perfect!" / "Nice!"** — Sycophantic acknowledgment of routine actions.
- **"Oops!" / "Uh oh!" / "Whoops!"** — Infantilizing. Errors are not endearing.
- **"Simply..." / "Just..."** — Minimizers. They condescend to the user about how easy the task is.
- **"We" referring to the product.** SingleStack is not a "we." It is a product. The team behind it can say "we" in marketing; the product itself says "SingleStack" or nothing.
- **"As an AI..."** — Agents never identify as AI. They identify by name.
- **"I'd be happy to..."** — Wasted words. Just do the work and report.
- **"Sorry,"** — For routine failures. Reserved for genuinely consequential issues.
- **"Please"** — Mostly removable. "Please enter your email" → "Email." The interface is not begging.
- **"Successfully [verb]ed!"** — The exclamation is wrong; the word "successfully" is usually redundant.
- **"Click here"** / **"Tap here"** — Tells the user what the cursor already tells them.
- **"Don't worry, your data is safe."** — If the user has reason to worry, address the reason. Reassurance without substance erodes trust.
- **Emoji in product chrome.** Functional icons only. Already covered in `singlestack-ui` §4; called out again because copy is where it sneaks in.
- **All-caps for emphasis.** Italics or weight changes carry emphasis; all-caps reads as shouting.

---

## 11. Before/After Examples

A working calibration set. When in doubt, the right-hand column.

| Context | Bad | SingleStack |
|---|---|---|
| Empty Concepts list | "No items yet! 🎉 Add your first Concept to get started!" | "No Concepts in this signal yet. Creative Officer will surface them as signals arrive." |
| Loading state (5s) | "Loading… please wait." | "Pulling Gong transcripts… 5s elapsed." |
| Save success | "Successfully saved! 🎉" | "Saved." |
| Network error | "Oops! Something went wrong. Please try again." | "Couldn't save — connection lost. Your changes are preserved in draft. [Retry]" |
| Confirmation | "Are you sure you want to delete?" | "Delete this Product Record? This removes 47 Features, 14 GTM Records, 312 Sources, and 89 Ratifications. Cannot be undone." |
| Agent opening | "Hi! I'm Creative Officer. I'd love to help you with concepts today!" | "Creative Officer drafted 3 concepts from the GovDash signal. Ratify, edit, or dismiss." |
| Validation error | "Invalid input." | "Positioning statement is required." |
| Tooltip on Source chip | "Click to view source." | "Shows the Source this claim came from." |
| Notification | "Your battlecard has been published successfully! 🎉" | "Battlecard published. Available in Enablement." |
| Agent recovery | "Sorry, I made a mistake!" | "Drafted from an outdated Source. Re-drafting with current Sources." |

---

## 12. Self-Check

Before claiming a piece of copy is done, walk this list.

- Could I remove any word without losing meaning? (If yes, remove it.)
- Is anything generic that could be specific? (Names, numbers, object types — substitute them in.)
- Does the copy perform enthusiasm, apology, or hype? (If yes, strip it.)
- For an error: are the three pieces present — what failed, why, what next?
- For an empty state: do I say what this surface is for and what populates it?
- For an agent message: is it third-person, action-led, citation-supported, free of "I'd be happy to"?
- For a button: does the label say what specifically happens?
- Would a sharp PMM colleague write this in a quick Slack message? If they'd phrase it differently, rewrite it their way.

When the answers are right, ship.

---

## 13. When in Doubt

Defer to: Linear's product copy (the gold standard for software-tool voice), Stripe's documentation tone (precise, never cute), and Notion's destructive-action confirmations (specific, weighty, no hedging). When a piece of copy feels wrong but you cannot name why, it is almost always one of:

1. The copy is performing instead of reporting.
2. There's a generic word where a specific one would land.
3. An apology, hedge, or pleasantry is doing the work that a clear statement should.
4. The agent is speaking like a chatbot instead of a co-worker.
5. The user can read the copy without learning anything they didn't already know.

Fix the cause, not the symptom.
