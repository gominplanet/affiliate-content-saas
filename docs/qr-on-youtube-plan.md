# QR codes on YouTube cuts

A QR burned into the YouTube copy of a review, so somebody watching on a TV
can reach the product. A TV viewer cannot click anything: the description box
does not exist for them, and that is the entire opportunity.

Opt-in per upload. Never on the Amazon original.

---

## The one architectural decision

**The QR encodes a permanent code. It never encodes a destination.**

A published video cannot be recalled, patched or reburned. Whatever goes in
that QR is there for as long as the video exists. So the only durable choice
is to put nothing durable in it.

The code is bound to the **video**, not to a post and not to a product page.
Code to video, video to whatever its best destination is right now.

This absorbs the three things that will actually go wrong:

- **Amazon changes its mind.** One resolver change and every QR on every
  customer video complies by the next scan. Encode destinations and you have
  permanently published violations you cannot withdraw.
- **The product dies.** ASINs get delisted and merged. A hardcoded product URL
  rots; a resolver sends the scan somewhere useful for years.
- **The address moves.** `lib/post-site.ts` exists because a creator's posts
  got filed against the wrong site. Slugs get edited, sites rebuilt, domains
  moved. All of that becomes a database update.

---

## Where a scan lands

`app/shop/[handle]/[asin]/page.tsx` already is the destination, and already
carries everything needed: the product picture, the buy button on the
creator's own affiliate link through the existing click counter, their review
and video when they have them, and the disclosure that `app/shop/[handle]`
already renders ("As an Amazon Associate, NAME earns from qualifying
purchases").

Resolution order for a code:

1. The creator's own blog post for that video, if one exists
2. `/shop/<handle>/<asin>`, which is true from the first second
3. Never Amazon directly

Most burns start at 2 and never leave it, because MVP is meeting the video for
the first time and no blog post exists yet. That is fine. Step 2 is a real
page, not a placeholder.

**Do not publish a stub post to the creator's blog at burn time.** Thin content
indexed on a review site is an SEO negative, and writing to somebody's blog
because they ticked a box is a surprise that costs trust. When they run
Video-to-Blog later, attach the new post to the video and the resolver moves
every QR already in the wild.

---

## The hard invariant

**A `/v/` code can never resolve to an Amazon URL.** Enforce it in the
resolver and cover it with a test that fails if it ever can.

This is the whole compliance argument, so it should be a guarantee in code
rather than a convention in somebody's head. Passport links
(`lib/passport-links.ts`) resolve to Amazon with the creator's tag. These
resolve to content. The hop looks identical from outside and the endpoint is
the entire difference between a compliant QR and a banned one.

Keep the paths visibly separate: `/go/<code>` for Passport, `/v/<code>` for
this.

---

## What the creator declares with Amazon, and what they must not

Amazon's website list says: *"List all the top level websites and/or mobile
apps on which you plan to display banners, widgets, Special Links, or other
ads from Amazon Associates."*

**Display** is the operative word.

### Declare this

```
https://mvpaffiliate.io/shop/<handle>
```

Top level of their shop, which covers every `/shop/<handle>/<asin>` beneath
it. This is where their links are actually displayed.

Precedent that this category is accepted: Seb's own Associates account lists
`https://linktr.ee/gominplanet`, a hosted link-in-bio page on a domain he does
not own, displaying his tag. Amazon has it listed and accepted. Enter the path
rather than the bare domain, exactly as the Linktree entry does.

Limit is 50 properties, so there is room.

### Do NOT declare mvpl.ink, and do not declare the resolver

Nothing is displayed on either. They are redirects. A redirect is the link,
not the place the link lives.

Declaring `mvpl.ink` would be worse than pointless: it declares MVP's
affiliate redirect service as the creator's website, which is inaccurate and
invites exactly the scrutiny this document exists to avoid.

### And give it its own tracking ID

The guide's Tagging module already teaches one tracking ID per platform. A
dedicated ID for the shop page means Amazon sees traffic arriving through a
declared property under a labelled ID the creator made on purpose, rather than
unexplained volume on a shared ID from a domain Amazon has never heard of.

It is also the only way either party finds out whether any of this earns
anything. Reported CTV scan rates run 0.04% to 0.8%, so the number matters.

**Amazon says a new tracking ID can take up to 24 hours to switch on.** Hold
the first burn or warn clearly, or the first links are dead on a video that is
already public.

---

## Setup flow, required not optional

1. Show their page URL with a copy button
2. Link to Your Associates Account, Edit Your Website, Mobile App, And Alexa
   Skill List, and show the screenshot. Most of them listed their Linktree and
   YouTube there already and will recognise it
3. Ask for the tracking ID they created, use it on their shop page links
4. Require a tick: *I have added this URL to my Amazon account*
5. Hold the first burn 24 hours if the tracking ID is new

Step 4 matters. It means MVP told them, showed them, and would not proceed
until they confirmed.

---

## The burn

No new pipeline. `lib/liftoff-cleanup.ts` already separates the original from
the CTA-burned copy YouTube gets, and `lib/cta-stickers.ts` already burns PNG
overlays. The QR is one more PNG in a filter chain that is already running, so
the marginal cost per video is about a second of encode.

- YouTube copy only. The guide lists heavy on-screen text as an Amazon
  rejection reason, so the Amazon original stays clean
- Creator picks size and corner, same controls as the CTA stickers
- `qrcode` is already a dependency, used by TRYBE's printable planner
- **Fail closed.** No destination, no QR. Never put a code into a permanent
  video that can 404

Rendering guidance, from CTV sources that disagree with each other, so treat
as a starting point: 300x300px floor on 1080p and 400x400 safer for
compression loss, black on white, quiet background, 10 to 15 seconds on
screen, lower right where viewers expect it.

---

## Costs, in plain terms

| | |
| --- | --- |
| Burn per video | About zero. The re-encode already happens |
| Redirect per scan | One indexed row read and a 302 |
| Every churned customer, forever | Less than one subscription a month, combined |
| Domain | Roughly $30 a year, in perpetuity, non-negotiable |
| Real cost | Engineering time |

Scale check: 500 customers at 100 videos a year is 50,000 codes a year, about
10MB of rows. At 2,000 lifetime views a video and a 0.3% scan rate that is
roughly 300,000 redirects a year across the whole base, which is under one
request a minute.

---

## Churn policy, decide once

**A churned customer's codes keep resolving to their last known destination,
permanently and free.**

Their videos run forever with MVP's code burned in. If the resolver dies when
they stop paying, MVP has broken work they published in good faith, and that
story travels. It costs a redirect, and being able to promise it out loud is
worth more than it costs.

The domain is the same commitment. Whatever goes in that QR must be a
registration that never lapses: locked, auto-renewed, paid years ahead, never
used for anything experimental. If it goes, every QR on every customer video
dies at once.

---

## What is settled and what is not

**Settled.** Where the page lives. Section 9 says links may not be displayed
on a site that is not yours, and a declared hosted page is the normal way
Associates handle this. The Linktree entry in a real account is the proof.

**Not settled.** Section 7(b) bars use on Internet-enabled television and TV
set-top boxes except under a separate written agreement. A TV is the whole
premise here.

The defence is that the QR encodes no Associates tag, the TV displays a URL to
a content page, and the affiliate link is clicked later on a phone on a web
page. The counter is that the mechanism exists to move a TV viewer into an
affiliate purchase. The defence looks stronger. It is not certain.

**Send one email to Associates support before launch.** The question is
narrow and answerable: *a QR code shown in a YouTube video, resolving to the
creator's hosted product page which carries their tag and disclosure and is
declared in their website list, does this comply with Sections 6, 7(b) and 9?*

A written answer settles it permanently for the whole customer base and
becomes a claim no competitor can make.

The reason to ask first rather than after: if this is wrong, MVP does not lose
a feature. Customers lose the income their Associates account represents, and
they lose it because the software told them it was fine.

---

## Associates support's answer (Seb, 2026-10-19)

Seb asked Associates support about QR codes and had a written reply:

> Yes, you can use a QR code to direct customers to your sites as long as it
> doesn't contain any product links.

with the Operating Agreement and the Participation Requirements linked.

**What it settles.** A QR is allowed when it leads to the creator's own site
and carries no product link. That is this design exactly: the QR holds only
`/v/<code>` on MVP's own origin, the code resolves to the creator's own blog
post or their declared shop page, and `neverAmazon` (tested in
scripts/test-video-qr.ts) stops it ever resolving to Amazon, an Amazon
shortener or a Passport link. Nothing in this design needs to change.

**What it does not say.** The reply does not mention televisions, so whether
it covers Section 7(b) depends on the question it answered. If the question
named YouTube watched on a TV, it is covered; if not, one follow-up naming it
closes the last open point above. The shop page also counts as "your site"
only once the creator has declared it in their Associates website list, which
is why the setup flow requires that tick before the first burn.
