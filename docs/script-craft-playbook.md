# Script craft playbook: how the story-time scripts were written

From Seb, 2026-11-16. How the batch scripts for a brand challenge get written, learned over several rounds of hand editing with a working creator. MVP's batch scripts (TRYBE, Brand scripts, "A batch") follow it: see "Where it lives in MVP" at the end.

## Context

A Story-Time Script Generator inside MVP Affiliate writes batches of shoot-ready short-form UGC scripts for brand creator programs (for example a TRYBE challenge for the NOBL Air Tracker, where a creator needs 300 unique approved videos in a month).

We went through several rounds of scripts by hand with a human editor (Seb, a working creator) before landing on a version that gets approved and that he would actually shoot. This document captures how those scripts were written and what went wrong along the way.

## 1. How the editing process actually went

* v1, rejected: 300 scripts that read like ads. The product showed up in the first line, CTAs were salesy, and lots of scenes were physically impossible for our shoot (the gate, baggage claim and a cruise terminal we couldn't get into).
* v2: the brand changed the rules: no product, brand name or suitcase in the first 15 seconds. Open with a story. That made the scripts better, but many still didn't make sense ("I'm at the gate watching them load my bag" on a day we weren't flying).
* v3, approved: before writing, the creator was asked four questions: are you actually traveling, which areas can you physically film in, who's on camera, and what format do you want. Every script was then written to be logically true for that exact shoot. That's what fixed it.
* v4, approved: a themed mini-batch (Mich in the car, B-roll of walking our French bulldog Walter, tied to the product through a story).

Lesson for the pipeline: collect filming reality before generating, and treat logic violations as hard failures, not style issues.

## 2. The script formula

Every script has two halves.

A. Story (0:00 to the product delay, usually 15 to 20s): 4 beats, about 38 to 50 words

1. The opener: a specific, visual, first-person or observational line that sets a scene ("Stand in the check-in hall at SXM for five minutes and you'll see the same thing over and over.").
2. The detail: a concrete, sensory or relatable specific ("Someone hands their bag over, the agent prints a sticker, and it rolls away on the belt.").
3. The turn: a tension, irony or realization ("Then they do this little look back over their shoulder.").
4. The stakes: why it matters, said plainly ("That's the last time they see it until the other end. No way to check on it in between.").

B. Product (after the delay): 4 beats, about 45 to 60 words

5. The pivot: casual, past-tense, personal ("So now there's a NOBL Air Tracker in every bag we check."). Never "Introducing" or "Check out".
6. Demo beat 1: one approved feature, with a matching screen.
7. Demo beat 2: a different approved feature, or the payoff line that closes the story's loop ("No more look back. I just check my phone.").
8. Soft close: "It's linked below." / "Link's below if you check bags." Generic sale language is allowed only here, and only if the brief allows it.

Total target is 35 to 50 seconds. Estimate at 2.5 words per second for the story and 2.6 for the product half. [VALIDATE] story word count at least productDelaySec × 2.3.

## 3. The four story angles (rotate evenly) [PROMPT]

* Stress: a tense, familiar moment (overweight at the counter, tight connection, kids in the check-in line).
* Thing nobody thinks of: a non-obvious truth ("almost every flight off the island is a connection, and your bag switches planes without you").
* Relief: a moment where something didn't go wrong ("first walk after a trip, and I realized I never stressed once").
* Aha moment: a realization that reframes something ("the ribbon helps you spot the bag; it doesn't tell you where it is").

## 4. The tie-in technique (how unrelated subjects connect to the product) [PROMPT]

When a campaign has a theme that isn't the product (a dog, a beach, a commute, a job), find the bridge: a trait of the theme that mirrors the product's problem.

* Walter on a leash ↔ bags handed to strangers with no leash.
* Walter's nose finds a dropped fry ↔ you can't find your bag.
* Two-page dog-sitter checklist ↔ the suitcase gets a paper sticker.
* Shipping job: every container is tracked ↔ our luggage isn't.
* A ribbon on the bag ↔ spotting it isn't the same as knowing where it is.

Rules:

* The theme carries the story half. The bridge line is the turn or the stakes beat. The product only answers the problem the bridge created.
* Never change what the product is to fit the theme. A luggage tracker is never put on the dog, because that's an unapproved claim. [VALIDATE] the product's use context must match the brief (e.g. the tracker goes in a bag).
* The close can return to the theme ("It's linked below. Walter approves.").

## 5. Logic and truth rules (the ones that broke v1 and v2)

Filming reality [VALIDATE]

* Every "say" and "show" must be physically possible at the selected location under its access notes. Example deny list for "airport, before security": gate, boarding, jet bridge, duty free, watching them load, plane window, baggage claim/carousel as a place you're standing.
* If `isTraveling = false`, there are no present-tense travel claims ("I'm checking in", "my bag just landed", "boarding now"). Allowed reasons to be there: dropping someone off, observing, recalling a past trip, prepping the night before (filmed at home).
* `onePersonPerVideo`: no shot shows two cast members. The second person can only be referenced ("Mich and I always..."), or be off camera ("waving at someone off camera").
* Talking-in-car scripts are filmed parked. Say so in the shot note.

Demo consistency [VALIDATE + PROMPT]

* Every feature claim pairs with a show that demonstrates it (live map line → live map screen recording).
* If the creator isn't traveling, app footage is labeled "screen recording from your last trip" (only if the brand allows reusing app footage).
* Drop-off logic must hold: a tracker paired to the creator's phone, placed in a family member's bag, so the creator can watch it. The tracker is placed and paired before filming, and the live map is recorded for real.

Truth [VALIDATE flag, PROMPT]

* Any script that describes a specific past event or names a real person (wife, mom, in-laws, a friend, a follower's comment) gets `realStory: true`. The UI shows: "★ Shoot only if true, or swap in your own details." Never present invented experiences as fact.
* Stats and facts are hedged unless sourced ("a lot of airlines restrict snub-nosed breeds in cargo," not "airlines ban Frenchies").
* Never invent comments, quotes or numbers.

Product delay [VALIDATE]

* Before `productDelaySec`: no brand name, no product name, no product-category word ("tracker"), none of the creator's own product-related objects on screen (their suitcase), and no talk about the product's features. Other travelers' luggage in the background is fine.
* The title and on-screen text (0 to 2s) must also be product-free.

Brief compliance [VALIDATE]

* Exact product name and casing ("NOBL Air Tracker" / "NOBL Tracker"; never "Nobl" or "AirTag").
* Only approved claims (for NOBL: live map, trip timeline, arrival alert, unexpected-movement alert, pull-tab pairing in about 30 seconds, Bluetooth plus Location Services, iOS plus Android).
* Banned: prices, percentages, "free" offers, named sales, competitor names, unapproved comparisons (an MVP starter script once said "same price"; that's out).

## 6. Voice and style [PROMPT]

* Talk like you're telling a friend, not reading an ad. Contractions, short sentences, a little self-deprecation ("I know he can't read. Let me have this.").
* Concrete over generic: "fifty-two pounds", "Miami, Charlotte, New York", "guava jam".
* Use local and creator context when it's true (lives in St. Maarten since 2010, works in shipping, travel creator).
* Signature hooks are used sparingly (no more than 1 in 5 scripts): "Nobody mentions this...", "I wish I knew this earlier...", "Pause for a second...", "Ever notice this pattern...", "Here's the real truth...", "Let me save you hours...", "This may surprise you...", "You need this now...", "You may not agree with this...", "I just figured this out...".
* Shows are specific and shootable in one take: framing, action, emotion ("Mich mimes kneeling and shuffling things, laughing"). Each story beat gets its own shot. Fresh footage per video; never reuse a B-roll clip across scripts.
* The product pivot rotates phrasing. Never repeat the same pivot line in more than about 10% of a batch.

## 7. Worked examples (few-shots and test fixtures)

GOOD: airport, not traveling, observational (passes)

* Story: "Stand in the check-in hall at SXM for five minutes and you'll see the same thing over and over." / "Someone hands their bag over, the agent prints a sticker, and it rolls away on the belt." / "Then they do this little look back over their shoulder." / "That's the last time they see it until the other end. No way to check on it in between."
* Product: "On our trips now, every bag we check has a NOBL Air Tracker inside." / "Last trip, I could open the NOBL app and see our bag on a live map the whole way." (show: screen recording from your last trip) / "No more look back. I just check my phone." / "Link's below if you check bags."

GOOD: drop-off (passes)

* Story: "I just dropped my mom off for her flight home." / "She has two connections, and she's not the type to sit on hold with an airline." / "Every time she flies, I'm the one who gets the call when something goes wrong." / "This time, I'm a lot less nervous, and here's why."
* Product: the tracker was paired to my phone and put in her suitcase the night before; live map recorded at the curb; arrival alert; soft close.

GOOD: themed tie-in (passes)

* Story: "On my walk with Walter this morning, I realized something kind of embarrassing." / "I would never let him off the leash somewhere new." / "But every time we fly, I hand our bags to total strangers and just walk away." / "No leash, no way to check on them. Until we land."
* Product: "So now our checked bag has a NOBL Air Tracker in it. Basically, a leash for the luggage." / live map / arrival alert / "It's linked below. Walter approves."

BAD: fails product delay

* "I put my NOBL Air Tracker in my bag before every trip..." as the opening line.

BAD: fails location logic (airport before security)

* "I'm at the gate watching them load our plane right now."

BAD: fails traveling logic (isTraveling = false)

* "I'm checking in for my flight and I'm completely calm, here's why."

BAD: fails one-person rule

* Show: "Seb and Mich arguing at the counter."

BAD: fails claims/brand

* "It's an AirTag but better, and it's 30% off."
* Putting the luggage tracker on the dog's collar.

BAD: reads like an ad

* "Introducing the NOBL Air Tracker, the ultimate travel gadget you need!"

## 8. Batch-level rules [VALIDATE]

* Spread evenly across locations, hosts and angles (planner function, not the LLM).
* No duplicate titles, openers or full bodies. Flag near-duplicates (similarity above 0.85).
* Pivot phrases and CTAs rotate. The generic sale line appears in no more than 1 in 10 scripts.
* Every batch output gets a self-critique pass: "Would a creator actually be able to shoot this exactly as written at this location today? Does any line sound like an ad?" Regenerate any script that fails.

## 9. Before generating, always ask (the four questions)

If campaign settings are missing, the UI must ask before generating:

1. Are you actually traveling on the shoot day?
2. Which exact areas can you film in, and what's off-limits?
3. Who's on camera, and is it one person per video?
4. What output do you want (PDF, CSV, in-app)?

## Where it lives in MVP

* The writer's instructions: `writerSystem()` and `campaignBlock()` in `lib/trybe-batch.ts`. They carry the formula (section 2), the angles (3), the tie-in with the creator's context (4), the logic and truth rules (5), the voice (6), two of the worked examples (7) and the self-check before answering (8).
* The context: the Context box on the batch card and in the setup. `CONTEXT_SYSTEM` reads it into names to use, story ideas (each a detail bridged to the product's problem), what stays apart from the product, facts said with care, and where the context says you film. Each script gets the next idea in turn (`seedFor`).
* The deterministic checks: `checkScript()` in `lib/trybe-batch.ts`. Hard failures (red, rewritten up to twice): the product delay (names, category words, objects, feature talk, story words at least delay × 2.3), places and their deny lists, travelling today, one person on camera, approved claims only, banned words, prices, percentages, spelling, comparisons, ad phrasing, the product used on the context (the tracker on the dog), repeats and near copies. Warnings (amber): a feature line with no shot of it, app footage not labelled from your last trip, the same product line in more than 1 in 10 scripts, sale lines in more than 1 in 10, signature openers in more than 1 in 5, a story that leaves the context out, length outside the target.
* Real stories: the writer's flag, and the parser marks any story naming a real person (my mom, a follower) to shoot only if true.
* The four questions: the plan card shown before writing names anything missing (where you film, who is on camera, the claims) with a button to add it; travelling is set in the setup and shown on the plan. PDF and CSV are always there.
* The fixtures: section 7's good and bad examples are tests in `scripts/test-trybe-batch.ts`.
