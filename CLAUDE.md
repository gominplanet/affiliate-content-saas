# Working agreements for this repo

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
