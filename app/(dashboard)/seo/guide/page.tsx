// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SEO GUIDE (Seb, 2026-10-12: "write a quick guide for confused users
// about /seo. The guide should be clickable at the top of that page and be
// thoroughly detailed but explained clearly").
//
// One page that walks a creator through SEO & Indexing from nothing: what the
// page is for, the first fifteen minutes, a weekly routine, every section,
// every stage on the board, the worries people actually have, and every word.
// The section names, stages, terms and tools are read from the same lists the
// SEO page uses (lib/seo-glossary, lib/post-doctor), so the guide cannot say a
// name the page no longer shows. Checked by scripts/test-seo-guide.

import Link from 'next/link'
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { TERMS, JOURNEY, SECTIONS, TOOLS } from '@/lib/seo-glossary'
import { LANES, REQUESTS_PER_DAY, type Lane } from '@/lib/post-doctor'

const PURPLE = '#7C3AED'

/** What to do with a post in each stage of the board. */
const LANE_DO: Record<Lane, string> = {
  blocked: 'Open the post on the board and read the red line: it names what is wrong, such as a page that tells Google not to show it, or an address that does not open. Fix that one thing first. Links and requests do nothing for a post Google is told to skip.',
  close: 'Your quickest wins. Press the plan\'s link button so your strongest posts point to these, refresh each post so it answers the search better than the posts above it, and send the brand your review: one link from another site moves a page two post more than anything else.',
  unseen: 'Follow the plan from the top: make sure every post is in your sitemap (Get my blog found does it), add links from posts Google already shows, open today\'s requests to Google, and share the ones never shared. Do not press Request indexing on all of them at once.',
  passed: 'Google read these and kept similar pages instead. Make each one worth keeping: your own photos or video, real testing notes, a clear verdict near the top. Rebuild a thin post from its video. Then link to it, and only then ask Google to look again, once.',
  unclicked: 'People see these and pick another result. Rewrite the title so it says what the searcher wants: the product, your verdict, who it is for. Title Check rewrites them for you.',
  buried: 'Google has them and shows them for almost nothing. Add links from your strongest posts, check the title names a real search, and send the brand your review for a link from their site.',
  fresh: 'Too new to judge. Share each one so it gets first readers, and link to it from an older post Google already shows. Then leave it a week or two.',
  waiting: 'Nothing to do. MVP has not had Google\'s answer for these yet and checks again overnight. Check back tomorrow.',
  working: 'These earn. Keep them up to date when the product changes, and link your new posts on the same topic to them so they lift the new ones.',
}

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'My SEO score is 100. Why do I get no visitors?', a: 'The score checks the basics on the page: title, headings, images, links, product details. It does not check whether Google has the post or shows it. A post with a perfect score that Google never read gets nobody. Look at the board instead: it says which stage each post is stuck at.' },
  { q: 'Should I press Request indexing on every post?', a: `No. Search Console allows about ${REQUESTS_PER_DAY} a day, and asking twice about the same post does not help. MVP lists today's ${REQUESTS_PER_DAY}, the ones with a path in first, and lists the next ones tomorrow. A link from a post Google already shows does more than a request.` },
  { q: 'It says "Discovered, not indexed". Is something broken?', a: 'No. Google knows the address and has not got round to reading it. On a young blog Google reads a few pages a day and picks the ones other pages point to. Links from your posts in Google are what get it read.' },
  { q: 'It says "Crawled, not indexed". What now?', a: 'Google read the post and decided it adds little over pages it already has. Asking again does not change that. Improve the post (your own photos, testing, a clear verdict), link to it, and then ask once.' },
  { q: 'How long does all of this take?', a: 'Google usually takes days to weeks with a new post, and longer on a new blog. Views in Google come first, then clicks. Judge a post after a few weeks, not a few days, and judge the blog by the trend on the chart, not by one day.' },
  { q: 'Why are the numbers different from what Search Console shows?', a: 'MVP reads Search Console every night and shows the last 28 days. Google itself reports a couple of days late. Small differences between the two come from the dates each one covers.' },
  { q: 'I connected Search Console and everything still says waiting.', a: 'MVP reads Google overnight. Come back tomorrow. If it still says waiting after a day, check that you connected the Google account that owns the blog in Search Console, and that the property address matches your blog\'s address exactly.' },
  { q: 'Does Bing matter?', a: 'Yes, more than people think: Bing also feeds Copilot and other AI answers. MVP tells Bing and Copilot about every new or changed post by itself. Google does not take those messages; it reads your sitemap instead.' },
  { q: 'Can a Fix button break my post?', a: 'Fix changes only the thing its line names, such as a missing description or an image with no description, on that post. Rebuild is bigger: it rewrites a weak post from its video at the same address, so the link and its history stay. Read what a button says before you press it.' },
  { q: 'Can I pay or do something to make Google index faster?', a: 'No one can force Google. What you control: every post in your sitemap, links between your posts, posts that are clearly better than what Google already has, shares that bring first readers, and links from other sites (earn them; never buy them).' },
]

const h2 = 'text-[19px] font-bold mb-2 scroll-mt-24'
const p = 'text-[14px] leading-relaxed max-w-[68ch]'
const box = 'rounded-xl border px-4 py-3.5'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mb-10 scroll-mt-24">
      <h2 id={`${id}-h`} className={h2} style={{ color: 'var(--text)', textWrap: 'balance' } as React.CSSProperties}>{title}</h2>
      <div className="flex flex-col gap-3" style={{ color: 'var(--text-2)' }}>{children}</div>
    </section>
  )
}

const CONTENTS: Array<{ id: string; label: string }> = [
  { id: 'start', label: 'What this page is for' },
  { id: 'path', label: 'The four steps to a reader' },
  { id: 'first', label: 'Your first 15 minutes' },
  { id: 'routine', label: 'A 10 minute weekly routine' },
  { id: 'sections', label: 'Every section of the page' },
  { id: 'stages', label: 'The stages on the board' },
  { id: 'who', label: 'What MVP does and what only you can do' },
  { id: 'faq', label: 'Questions people ask' },
  { id: 'words', label: 'Every word, in plain language' },
  { id: 'tools', label: 'The other SEO tools' },
]

export default function SeoGuidePage() {
  return (
    <>
      <PageHero
        title="SEO guide"
        accent="rgba(16, 185, 129, 0.30)"
        subtitle="Everything on the SEO & Indexing page, explained from the start. About a 10 minute read; jump to the part you need."
        actions={
          <Link href="/seo" className="px-3.5 py-2 rounded-lg border text-[13px] font-semibold inline-flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}>
            <ArrowLeft size={13} /> Back to SEO & Indexing
          </Link>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="In this guide" className="lg:sticky lg:top-6 self-start">
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-2)' }}>In this guide</p>
          <ol className="flex flex-col gap-1">
            {CONTENTS.map((c) => (
              <li key={c.id}><a href={`#${c.id}`} className="text-[13px] hover:underline" style={{ color: 'var(--text)' }}>{c.label}</a></li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          <Section id="start" title="What this page is for">
            <p className={p}>
              Your blog earns when people find a post on Google, read it and click your product links. The SEO & Indexing page shows where each of your posts is on that path, and what to do to move it along. It does not ask you to learn SEO: every section says what it is, what it means for you, and has buttons that do the work.
            </p>
            <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text)' }}>If you read only one thing</p>
              <p className={p}>
                Connect Search Console once. Then, each week, open <strong>What each post needs</strong>, pick the stage with the most posts, and follow its plan from the top. That is the whole job. Everything else on the page helps with it.
              </p>
            </div>
            <p className={p}>
              Every <strong>?</strong> on the page explains the word next to it, and every section can be folded away with <strong>Hide</strong>. MVP remembers what you folded.
            </p>
          </Section>

          <Section id="path" title="The four steps to a reader">
            <p className={p}>Every post goes through the same four steps before it earns anything from Google. The page is built around them, and a post that is stuck on one step cannot skip to the next.</p>
            <ol className="grid gap-2 sm:grid-cols-2">
              {JOURNEY.map((j, i) => (
                <li key={j.id} className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}><span style={{ color: PURPLE }}>{i + 1}.</span> {j.title}</p>
                  <p className="text-[13px] mt-0.5">{j.says}</p>
                  <p className="text-[12px] mt-1">What shows it: {j.measure}.</p>
                </li>
              ))}
            </ol>
            <p className={p}>
              Most new blogs are stuck between steps 1 and 2: Google knows the posts exist and has not read them yet. That is normal, it is not a fault, and the board&apos;s plan for it is the fix.
            </p>
          </Section>

          <Section id="first" title="Your first 15 minutes">
            <ol className="flex flex-col gap-3 list-decimal pl-5 max-w-[68ch] text-[14px] leading-relaxed">
              <li>
                <strong style={{ color: 'var(--text)' }}>Connect Search Console.</strong> It is Google&apos;s free dashboard for your blog and the only place Google says which posts it has. Press <strong>Connect Search Console</strong> on the SEO page and sign in with the Google account that owns your blog there. No Search Console yet? Create a free property for your blog address at search.google.com/search-console first. Without it, MVP can check your posts but cannot tell you what Google does with them.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Submit your sitemap once.</strong> Your sitemap is the list of every post address Google reads. If Search Console does not have it yet, the SEO page says so and shows the exact address to paste, with a link to Search Console&apos;s Sitemaps page. Paste it there and press Submit. Google re-reads it by itself after that, and every new post is on it.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Press Get my blog found.</strong> It is in the section of the same name. It refreshes your sitemap, tells Bing and Copilot about every post, heals links whose address changed, and fixes the SEO basics it can on every post.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Come back tomorrow.</strong> MVP reads Search Console overnight. The next day the board sorts every post into its stage, and <strong>What to do next</strong> lists the few things worth your time.
              </li>
            </ol>
          </Section>

          <Section id="routine" title="A 10 minute weekly routine">
            <ol className="flex flex-col gap-2 list-decimal pl-5 max-w-[68ch] text-[14px] leading-relaxed">
              <li>Look at <strong>Is your blog growing?</strong> Rising views in Google mean it is working; give it time.</li>
              <li>Do the first item in <strong>What to do next</strong>. Items marked &quot;MVP does this&quot; are one button.</li>
              <li>Open <strong>What each post needs</strong>, pick the stage with the most posts, and press its plan&apos;s link button. It adds up to ten links between your posts per press.</li>
              <li>Open <strong>Today&apos;s {REQUESTS_PER_DAY}</strong> in that plan and press Request indexing in Search Console for each. MVP lists the next ones tomorrow.</li>
              <li>Share one or two posts that were never shared. The Share it button opens the share window straight away.</li>
            </ol>
            <p className={p}>That is enough. Doing more in one day does not make Google move faster; doing this every week does.</p>
          </Section>

          <Section id="sections" title="Every section of the page">
            <p className={p}>The page has seven numbered sections, top to bottom in the order that matters. Each title below opens that section on the page.</p>
            <div className="flex flex-col gap-2.5">
              {SECTIONS.map((s, i) => (
                <div key={s.id} className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <Link href={`/seo#${s.id}`} className="text-[14.5px] font-semibold hover:underline inline-flex items-center gap-1" style={{ color: 'var(--text)' }}>
                    <span style={{ color: PURPLE }}>{i + 1}.</span> {s.title} <ArrowRight size={13} />
                  </Link>
                  <p className="text-[13.5px] mt-1"><strong style={{ color: 'var(--text)' }}>What it is:</strong> {s.what}</p>
                  <p className="text-[13.5px] mt-1"><strong style={{ color: 'var(--text)' }}>What it means for you:</strong> {s.forYou}</p>
                  <p className="text-[12px] mt-1.5">Helps with: {s.helps.map((h) => JOURNEY.find((j) => j.id === h)?.title).filter(Boolean).join(', ')}.</p>
                </div>
              ))}
            </div>
            <p className={p}>
              The buttons along the top of the page (<strong>Tools</strong>) hold page wide jobs: <strong>Fix all posts</strong> fixes every post&apos;s fixable basics at once and shows you the changes first, <strong>Remove prices from posts</strong> takes Amazon prices out of your posts (Amazon only allows a price that comes from its own data with a time stamp), and <strong>Refresh post URLs</strong> re-reads each post&apos;s current address from WordPress. <strong>Refresh</strong> reloads the page&apos;s numbers.
            </p>
          </Section>

          <Section id="stages" title="The stages on the board">
            <p className={p}>
              <strong>What each post needs</strong> puts every post in the one stage it is stuck at, so you never have to work out what a post needs. Each stage opens with a plan for all its posts, and each post has its own steps. Work through them in this order:
            </p>
            <div className="flex flex-col gap-2.5">
              {LANES.map((l) => (
                <div key={l.id} className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{l.title}</p>
                  <p className="text-[13.5px] mt-0.5">{l.blurb}</p>
                  <p className="text-[13.5px] mt-1.5"><strong style={{ color: 'var(--text)' }}>What to do:</strong> {LANE_DO[l.id]}</p>
                </div>
              ))}
            </div>
            <p className={p}>
              About the link button: each press adds up to ten links, and never more than two new ones from any single post. Each link is a small card at the end of a post Google already shows, pointing to a post on the same topic. Every post it touches is republished on WordPress, so keep the page open until it says how many went in.
            </p>
          </Section>

          <Section id="who" title="What MVP does and what only you can do">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text)' }}>MVP does</p>
                <ul className="list-disc pl-4 text-[13.5px] leading-relaxed">
                  <li>Reads Search Console every night</li>
                  <li>Sorts every post into its stage and writes its plan</li>
                  <li>Adds links between your posts</li>
                  <li>Keeps your sitemap complete</li>
                  <li>Tells Bing and Copilot about every new or changed post</li>
                  <li>Sends broken addresses to the right post</li>
                  <li>Fixes the on page basics and rebuilds weak posts from their video</li>
                </ul>
              </div>
              <div className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Only you can</p>
                <ul className="list-disc pl-4 text-[13.5px] leading-relaxed">
                  <li>Press Request indexing in Search Console (Google allows no one else to)</li>
                  <li>Add your own photos, testing and verdict to a post</li>
                  <li>Share posts with your audience</li>
                  <li>Ask brands to link to your review</li>
                  <li>Keep publishing</li>
                </ul>
              </div>
            </div>
            <p className={p}>And nobody, MVP included, can make Google keep or rank a post. Google decides. Everything on the page is about removing anything on your side that stops it.</p>
          </Section>

          <Section id="faq" title="Questions people ask">
            <div className="flex flex-col gap-2">
              {FAQ.map((f) => (
                <details key={f.q} className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <summary className="cursor-pointer text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{f.q}</summary>
                  <p className="text-[13.5px] leading-relaxed mt-2 max-w-[68ch]">{f.a}</p>
                </details>
              ))}
            </div>
          </Section>

          <Section id="words" title="Every word, in plain language">
            <dl className="grid gap-2.5 sm:grid-cols-2">
              {TERMS.map((t) => (
                <div key={t.id} id={`word-${t.id}`} className={box} style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <dt className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{t.word}</dt>
                  <dd className="text-[13px] mt-0.5">{t.means}</dd>
                  <dd className="text-[13px] mt-1"><strong style={{ color: 'var(--text)' }}>For you:</strong> {t.forYou}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="tools" title="The other SEO tools">
            <p className={p}>The tabs at the top of the SEO page lead to tools for one job each. Use them when the page or the board points you there.</p>
            <ul className="flex flex-col gap-2">
              {TOOLS.map((t) => (
                <li key={t.href} className="text-[13.5px]">
                  <Link href={t.href} className="font-semibold hover:underline" style={{ color: PURPLE }}>{t.label}</Link>: {t.says}
                </li>
              ))}
            </ul>
          </Section>

          <div className="mb-10">
            <Link href="/seo" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13.5px] font-semibold text-white" style={{ background: PURPLE }}>
              <BookOpen size={14} /> Back to SEO & Indexing
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
