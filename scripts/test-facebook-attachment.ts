// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One attachment per Facebook post, so it has to be the one that was asked for.
//
// A Page post carries either a photo (/photos) or a link Facebook builds a card
// from (/feed). Never both. MVP always sent the photo — the YouTube thumbnail as
// a still — so a creator whose whole channel is video had no way to put the
// video itself in front of a Facebook audience. Handing Facebook the watch URL
// instead makes the card playable.
//
// The risk in adding a choice is not the happy path, it is the substitution. A
// post with no source video cannot honour "post the video", and if that falls
// back to a thumbnail behind a green tick, the creator picks the video option
// every week and never learns it never once happened. So the fallback is
// asserted to be announced, every time.
import { chooseFacebookAttachment, parseFacebookMediaChoice } from '../lib/facebook-attachment'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const IMAGE = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
const BLOG = 'https://gominreviews.com/arolina-swim-trunks-review'

// ── the default is exactly what MVP did before ──────────────────────────────
{
  const a = chooseFacebookAttachment({ requested: 'thumbnail', videoUrl: VIDEO, imageUrl: IMAGE, fallbackLink: BLOG })
  check('the thumbnail choice posts a photo', a.kind === 'photo')
  check('and posts the thumbnail', a.imageUrl === IMAGE)
  check('and says nothing, because nothing was substituted', a.note === null)
  check('and reports what went out', a.used === 'thumbnail')

  // The creator who never touches the control must get the old behaviour.
  check('an absent choice means thumbnail', parseFacebookMediaChoice(undefined) === 'thumbnail')
  check('a nonsense choice means thumbnail', parseFacebookMediaChoice('playable') === 'thumbnail')
  check('only the exact string opts in', parseFacebookMediaChoice('video') === 'video')
}

// ── the feature ─────────────────────────────────────────────────────────────
{
  const a = chooseFacebookAttachment({ requested: 'video', videoUrl: VIDEO, imageUrl: IMAGE, fallbackLink: BLOG })
  check('the video choice posts a link, not a photo', a.kind === 'link',
    'a photo post has no card at all, so a YouTube URL in the caption never becomes playable')
  check('and the card is built from the YouTube URL', a.link === VIDEO)
  check('and the thumbnail is not sent as well', a.imageUrl === undefined,
    'Facebook takes one attachment; sending both is not a thing that exists')
  check('and nothing is announced, because nothing was substituted', a.note === null)
  check('and it reports the video went out', a.used === 'video')
}

// ── the substitution, which must never be silent ────────────────────────────
{
  // A buying guide, a comparison, a link post: real content, no source video.
  const noVideo = chooseFacebookAttachment({ requested: 'video', videoUrl: null, imageUrl: IMAGE, fallbackLink: BLOG })
  check('with no video the post still goes out', noVideo.kind === 'photo' && noVideo.imageUrl === IMAGE,
    'refusing to publish over a missing video would be worse than substituting')
  check('and it reports the thumbnail, not the video', noVideo.used === 'thumbnail')
  check('and it says why', !!noVideo.note && /no YouTube video/i.test(noVideo.note!), String(noVideo.note))
  check('and the note is a sentence a creator can act on',
    /thumbnail/i.test(noVideo.note ?? ''), String(noVideo.note))

  // Nothing at all to attach: the blog post itself becomes the card.
  const nothing = chooseFacebookAttachment({ requested: 'video', videoUrl: '', imageUrl: '', fallbackLink: BLOG })
  check('with neither, the blog post becomes the card', nothing.kind === 'link' && nothing.link === BLOG)
  check('and that is reported as link-only', nothing.used === 'link-only')
  check('and it is announced', !!nothing.note)

  // The same substitution on the default path, which existed before and was
  // also silent.
  const noImage = chooseFacebookAttachment({ requested: 'thumbnail', videoUrl: VIDEO, imageUrl: null, fallbackLink: BLOG })
  check('a thumbnail request with no thumbnail falls back to the blog card',
    noImage.kind === 'link' && noImage.link === BLOG)
  check('and says so', !!noImage.note, String(noImage.note))

  // Whitespace is not a URL. A padded empty string reaching Facebook's /photos
  // endpoint is an API error, not an attachment.
  const blank = chooseFacebookAttachment({ requested: 'thumbnail', imageUrl: '   ', fallbackLink: BLOG })
  check('a blank image is treated as no image', blank.kind === 'link', String(blank.kind))
  const blankVideo = chooseFacebookAttachment({ requested: 'video', videoUrl: '  ', imageUrl: IMAGE, fallbackLink: BLOG })
  check('a blank video url is treated as no video', blankVideo.used === 'thumbnail')
}

// ── requested is always carried, so the caller can compare ──────────────────
{
  for (const requested of ['thumbnail', 'video'] as const) {
    const a = chooseFacebookAttachment({ requested, videoUrl: null, imageUrl: null, fallbackLink: BLOG })
    check(`a ${requested} request remembers what was asked for`, a.requested === requested,
      'without this the UI cannot tell a substitution from a plain result')
    check(`a ${requested} request that substitutes says so`, (a.used !== requested) === (a.note !== null),
      'a note without a substitution is noise; a substitution without a note is the bug')
  }
  // And the invariant in the normal direction: got what you asked for, no note.
  const ok = chooseFacebookAttachment({ requested: 'video', videoUrl: VIDEO, fallbackLink: BLOG })
  check('getting what you asked for carries no note', ok.used === ok.requested && ok.note === null)
}

// ── the wiring, so the choice actually reaches Facebook ─────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const ROUTE = readFileSync('app/api/blog/facebook-post/route.ts', 'utf8')
  const CRON = readFileSync('app/api/cron/process-scheduled/route.ts', 'utf8')
  const SCHED = readFileSync('app/api/blog/schedule-post/route.ts', 'utf8')
  const MODAL = readFileSync('components/content/SocialPreviewModal.tsx', 'utf8')

  check('the publish route reads the choice', /parseFacebookMediaChoice\(body\.media\)/.test(ROUTE))
  check('the publish route attaches what was chosen',
    /attachment\.kind === 'photo'/.test(ROUTE) && /attachment\.link \|\| shareUrl/.test(ROUTE))
  check('the publish route reports what actually went out', /mediaUsed:/.test(ROUTE) && /mediaNote:/.test(ROUTE))
  check('the preview says whether a video exists at all', /videoAvailable: !!videoUrl/.test(ROUTE),
    'offering an option the post cannot honour is how a creator picks it for a month')

  check('the modal only offers the video when there is one', /disabled=\{!videoAvailable\}/.test(MODAL))
  check('the modal sends the choice on publish', /media: mediaChoice/.test(MODAL))
  check('the modal shows the substitution note', /data\.mediaNote/.test(MODAL))

  check('scheduling persists the choice', /options\.media = 'video'/.test(SCHED))
  check('and does not drop the affiliate opt-in doing it', /options\.includeAffiliateCta = true/.test(SCHED),
    'both flags share one jsonb column; a spread that overwrites it loses the other')
  check('the cron honours the persisted choice', /parseFacebookMediaChoice\(/.test(CRON) && /fbAttachment/.test(CRON))
}

if (failures.length) {
  console.error(`\n❌ facebook-attachment: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ facebook-attachment: the post carries what was chosen, and says so out loud when it cannot')
