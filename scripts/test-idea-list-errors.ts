// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The idea-list reader says which thing went wrong.
//
// WHAT HAPPENED. Seb pasted https://www.amazon.com/shop/gominplanet into the
// "paste an idea-list link" box and the screen said:
//
//    Could not read that list. Double-check the link, or use the SCOUT
//    extension.
//
// The link was fine. It was his storefront, which is not a list, and the code
// already knew that: fetchIdeaList threw "That doesn't look like an Amazon
// idea-list link (amazon.com/shop/…/list/…)", which names the problem exactly.
// The route then passed it through toUserMessage, whose job is to stop raw
// provider errors reaching users, and which replaces every message it does not
// recognise with a generic fallback. So the one sentence that told him what was
// wrong was destroyed at the moment he went looking for it, and the advice that
// replaced it sent him to re-examine the only thing that was not the problem.
//
// Five causes were collapsed into that one sentence, and it is wrong for four
// of them. The bot-check case is the worst: its real message says "use the
// SCOUT extension", which is the actual fix, and the generic line offers SCOUT
// for every cause including the ones SCOUT cannot help with, which is the same
// as never offering it.
//
// THE FIX IS OPT-IN, and that matters. Forty-two call sites use toUserMessage
// and the whole point of that file is that a provider error never reaches a
// user. So nothing changes for any of them: only a message thrown as
// UserFacingError passes through, and throwing one is a statement that the
// sentence was written to be read.

import { readFileSync } from 'node:fs'
import { toUserMessage, UserFacingError } from '../lib/friendly-error'
import { isStorefrontUrl, normalizeListUrl } from '../lib/amazon-idea-list'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const LIST = live(read('lib/amazon-idea-list.ts'))
const GENERIC = 'Could not read that list. Double-check the link, or use the SCOUT extension.'

// ── a sentence we wrote reaches the person who needs it ────────────────────
{
  const mine = 'That is your storefront, not an idea list.'
  check('a message we authored survives sanitising',
    toUserMessage(new UserFacingError(mine), GENERIC) === mine,
    `got: ${toUserMessage(new UserFacingError(mine), GENERIC)}`)

  // THE ORDER INSIDE toUserMessage IS THE WHOLE TRICK. One of these sentences
  // is "Amazon would not return that list (403)", and the provider rules match
  // \b403\b. Run the passthrough second and that becomes "our content service
  // is busy", which blames us for Amazon and tells the reader to wait for
  // something that will never change on its own.
  const withCode = 'Amazon would not return that list (403). Try again in a moment, or use the SCOUT extension.'
  check('even when it contains something the provider rules match',
    toUserMessage(new UserFacingError(withCode), GENERIC) === withCode,
    `got: ${toUserMessage(new UserFacingError(withCode), GENERIC)}`)

  check('an empty one still falls back',
    toUserMessage(new UserFacingError('   '), GENERIC) === GENERIC,
    'a blank message is not a sentence, it is a bug wearing one')
}

// ── and a provider error still never does ──────────────────────────────────
//
// This is the guarantee the file exists for, and the thing an opt-out fix
// would have quietly broken across forty-two call sites.
{
  check('a credit error is still hidden',
    toUserMessage(new Error('anthropic: insufficient credit balance'), GENERIC)
      === 'Our content service is busy right now. Please try again in a minute.',
    'users must never read the word credit, or a provider name')
  check('a timeout is still its own neutral sentence',
    toUserMessage(new Error('fetch failed: ETIMEDOUT'), GENERIC)
      === 'That took too long to complete. Please try again in a moment.',
    '')
  check('and anything unrecognised still falls back',
    toUserMessage(new Error('TypeError: x is not a function'), GENERIC) === GENERIC,
    'a stack-trace fragment on screen is the failure this file prevents')
}

// ── the storefront, which is the mistake people actually make ──────────────
{
  check('the exact link that started this is recognised',
    isStorefrontUrl('https://www.amazon.com/shop/gominplanet'),
    'it is a real Amazon URL, just not a list, and "double-check the link" is useless advice for it')
  check('with or without the trailing slash',
    isStorefrontUrl('https://www.amazon.com/shop/gominplanet/'),
    '')
  check('on other Amazon domains too',
    isStorefrontUrl('https://www.amazon.co.uk/shop/someone'),
    'a UK creator pastes a UK storefront')

  check('a real list is NOT called a storefront',
    !isStorefrontUrl('https://www.amazon.com/shop/gominplanet/list/2QJ8XYZ12')
    && !!normalizeListUrl('https://www.amazon.com/shop/gominplanet/list/2QJ8XYZ12'),
    'the two must not both match or the right link gets the wrong sentence')
  check('and neither is a link to somewhere else entirely',
    !isStorefrontUrl('https://notamazon.com/shop/x') && !isStorefrontUrl('gominplanet'),
    'that one deserves the generic "this is not a list link" instead')
}

// ── each cause carries its own sentence ────────────────────────────────────
{
  check('every throw in the reader is a user-facing one',
    !/throw new Error\(/.test(LIST),
    'a plain Error here is a sentence that gets replaced by the generic line')

  check('the storefront gets its own answer',
    /isStorefrontUrl\(rawUrl\)/.test(LIST) && /not an idea list/.test(LIST),
    'telling somebody to double-check a valid link is telling them to look harder at the wrong thing')
  check('a deleted or private list reads differently from a blocked one',
    /res\.status === 404/.test(LIST) && /does not exist/.test(LIST),
    'one means the link is dead, the other means try again, and they need different actions')
  check('the bot check is the one place SCOUT is offered as the fix',
    /bot check\. Use the SCOUT extension instead/.test(LIST),
    'offering SCOUT for every cause is the same as never offering it')
  check('an empty list says it is empty',
    /opened fine but has no products/.test(LIST),
    'that is a different fact from "could not read", and the reader can see it is true')
}

// ── free-guide readers are a segment you can name ──────────────────────────
//
// They land in the same newsletter_subscribers table as the blog list, which
// is fine, and they arrive having been told exactly one thing: "Updates to
// this guide and what is changing in the program. Nothing else."
//
// The segment machinery already filtered on `source`, and 'freeguide' was not
// in the union or the picker. So there was no way to send to them and, worse,
// no way to leave them OUT of a blog issue they never asked for. Sending one
// to everybody would have broken the promise on the form and collected spam
// complaints against a sending domain that was only just verified.
{
  const SEND = read('lib/newsletter-send.ts')
  const COMPOSE = read('app/(dashboard)/newsletter/compose/page.tsx')
  const NLPAGE = read('app/(dashboard)/newsletter/page.tsx')

  check('the segment type knows about the guide',
    /'blog_form' \| 'csv_import' \| 'manual' \| 'freeguide' \| null/.test(SEND),
    'a source the filter cannot express is an audience you cannot protect')
  check('and the compose screen offers it',
    /<option value="freeguide">/.test(COMPOSE)
    && /'all' \| 'blog_form' \| 'csv_import' \| 'manual' \| 'freeguide'/.test(COMPOSE),
    'in the type and not in the picker is the same as not existing')

  // THE SCREEN SAID TWO TRUE THINGS THAT LOOKED LIKE A CONTRADICTION: the
  // subscriber count going up under "I'm not running a newsletter right now".
  // The switch is about the blog form; the guide has its own.
  check('the newsletter page explains where they came from',
    /came from the free guide, which has its own form/.test(NLPAGE),
    'the first person to see the count rise while the switch read off asked whether their signups had gone somewhere unexpected')
  check('and it does not invent a total from the rows on screen',
    /subs\.some\(x => x\.source === 'freeguide'\)/.test(NLPAGE)
    && !/freeguideCount/.test(NLPAGE),
    'counting a fetched page as a total is the mistake this codebase has made three times')
}

if (failures.length) {
  console.error(`\n❌ idea-list-errors: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ idea-list-errors: five causes, five sentences, and a provider error still never reaches a user')
