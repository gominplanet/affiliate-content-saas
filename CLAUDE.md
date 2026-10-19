# Working agreements for this repo

## Shipping: fast-forward main every time, without asking

Vercel deploys production from `main`. A commit that stops on a feature branch
is a commit Seb cannot test, and he tests on the live site.

So after pushing the feature branch, ALSO fast-forward `main` to it:

```
git push origin origin/<branch>:main
```

Check it is a clean fast-forward first (`git merge-base --is-ancestor
origin/main origin/<branch>`), and never force.

Do not stop to ask. Anything risky lives behind the Labs section, which only
Seb can see, so the cost of shipping early is near zero and the cost of not
shipping is real: ten commits once sat unreleased for a whole evening while he
tested a four hour old build and reported bugs that had already been fixed in
code he could not run. Half a session of confusion came from that alone.

If a change genuinely should not be live yet, put it behind Labs rather than
leaving it off `main`.

## Migrations: ALWAYS paste the SQL, never point at a file

Seb runs SQL by pasting it into the Supabase SQL editor. He does not open files
in the repo, does not run `npm`, and does not have the migration on his machine.

So whenever a change needs a migration, or a migration is referenced at all:

- Paste the **full SQL in the message**, in a code block, ready to copy.
- Never write "run migration 318" or "the migration I printed earlier" and
  leave it there. If it is worth mentioning, it is worth pasting again.
- This applies to re-mentions too. Repeating the paste costs nothing; making
  him scroll back through a day of messages to find it costs him time and has
  gone wrong more than once.
- Same rule for verification and diagnostic queries: paste them.
- Say plainly whether it is safe to run twice (it should be: prefer
  `add column if not exists`, `create or replace`, `drop ... if exists`).

The schema audit query (`npm run schema:audit` prints it) is the way to confirm
what is actually missing from the database. Paste that too rather than
describing it.

## Facts to get right

MVP sells exactly ONE plan: **Pro at $199/month** ($1,999/year). From
January 1, 2027 new members pay $299/month ($2,990/year); anyone who joined
before keeps their price for as long as they stay subscribed.

Since 2026-10-19 the **monthly** plan starts with **7 days free**: the card is
taken at signup, nothing is charged until day 8, and cancelling before then
costs nothing. One free week per creator (matched on card and email). The
**yearly** plan has no free week and is charged at signup. There is no refund;
members who paid on day one between 2026-10-18 and the free week keep the
7-day refund they joined with. The first 7 days run at a quarter of each
monthly allowance.
There is no free plan, and no Amazon, Creator or Studio plan to quote. Those
tier names still exist in `lib/tier.ts` for legacy accounts; never present
them as plans in reports, comparisons, copy or answers.

## Writing style

No em-dashes, en-dashes, or spaced-hyphen sentence breaks in anything
user-facing: messages, commit messages, PR bodies, UI copy. Rewrite the
sentence instead.

Never put the current year in a generated title or copy string.

## Reporting

Prefer reporting what actually happened over what was intended. Several bugs in
this codebase were invisible because a UI reported the plan rather than the
result: a post that "used Passport" while containing a geni.us link, a badge
that called every Passport link a plain Amazon link, a garment check whose
silence looked identical to a pass. When adding a feature, ask what its failure
looks like on screen, and make it distinguishable from success.
