/**
 * /docs/instagram-restricted — plain, user-facing help for when Instagram
 * restricts a connected account ("we detected a third-party app", posting
 * blocked, or MVP shows the account as connected but posts fail). Static server
 * component so support can share the link directly. Linked from Connect Socials.
 */
import Link from 'next/link'
import { ArrowLeft, ShieldAlert, CheckCircle2, Clock } from 'lucide-react'

export const metadata = {
  title: 'Instagram account restricted? — MVP Affiliate',
  description: 'Why Instagram restricts accounts that post through apps, how to get the restriction lifted, and how to keep it from happening again.',
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7C3AED] text-white text-sm font-bold flex items-center justify-center">{n}</span>
      <div className="pt-0.5">
        <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</p>
        <div className="text-[#4b4b4f] dark:text-[#b0b0b5] text-[15px] leading-relaxed mt-1">{children}</div>
      </div>
    </li>
  )
}

export default function InstagramRestrictedPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
      <header className="space-y-2">
        <Link href="/connect-socials" className="inline-flex items-center gap-1 text-sm text-[#86868b] hover:text-[#7C3AED]">
          <ArrowLeft size={14} /> Connect Socials
        </Link>
        <div className="flex items-center gap-2">
          <ShieldAlert size={22} className="text-[#ff9500]" />
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Instagram restricted your account?</h1>
        </div>
        <p className="text-[#6e6e73] dark:text-[#a1a1a6]">
          If Instagram is blocking your posts or showing a message about a third-party app, here&apos;s what&apos;s happening and how to fix it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">First, the important part</h2>
        <p className="text-[#4b4b4f] dark:text-[#b0b0b5] text-[15px] leading-relaxed">
          This is not because MVP isn&apos;t approved. MVP is fully approved by Meta to publish to Instagram. Instagram
          runs a separate, per-account system that watches for posting that looks automated, and it can flag any
          account regardless of which app is posting. No tool can turn that off. The good news: it&apos;s almost always
          temporary, and a few habits make it rare.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Why it usually happens</h2>
        <ul className="space-y-2 text-[15px] text-[#4b4b4f] dark:text-[#b0b0b5]">
          <li>• Too many posts in a short window, or posts fired back-to-back.</li>
          <li>• A brand-new or rarely-used account that suddenly starts posting through an app.</li>
          <li>• The same or near-identical content posted repeatedly.</li>
          <li>• A password change or a login Instagram thought looked unusual.</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">How to lift the restriction</h2>
        <ol className="space-y-4">
          <Step n={1} title="Open your account status">
            In the Instagram app: <span className="font-medium">Profile → the menu (≡) → Settings and privacy → Account status</span>.
            That page tells you exactly what Instagram flagged and whether you can request a review.
          </Step>
          <Step n={2} title="Request a review">
            If there&apos;s a <span className="font-medium">Request review</span> button, tap it and confirm. Most posting
            restrictions clear within 24–48 hours. There&apos;s nothing to pay and nothing to install.
          </Step>
          <Step n={3} title="Wait before reconnecting">
            While the restriction is active, Instagram will keep rejecting posts and can invalidate the connection, so
            reconnecting won&apos;t stick yet. Wait until Account status shows you&apos;re clear.
          </Step>
          <Step n={4} title="Reconnect in MVP">
            Once you&apos;re cleared, go to <Link href="/connect-socials" className="text-[#7C3AED] hover:underline font-medium">Connect Socials</Link> and reconnect Instagram.
            Then publish one post to confirm it goes through.
          </Step>
        </ol>
      </section>

      <section className="space-y-3 rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/[0.04] p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          <CheckCircle2 size={18} className="text-[#34c759]" /> Keep it from happening again
        </h2>
        <ul className="space-y-2 text-[15px] text-[#4b4b4f] dark:text-[#b0b0b5]">
          <li>• <span className="font-medium">Space your posts out.</span> MVP already keeps Instagram posts at least a few minutes apart and caps how many go out per hour, but if you&apos;re also posting manually, don&apos;t stack them on top of each other.</li>
          <li>• <span className="font-medium">Warm up a new account.</span> If the account is new, post a handful of times by hand over a week or two before leaning on auto-posting.</li>
          <li>• <span className="font-medium">Vary your content.</span> Different captions and images read as genuine; identical posts read as spam.</li>
          <li>• <span className="font-medium">Don&apos;t bulk-post after reconnecting.</span> Ease back in with one or two posts before returning to your normal pace.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          <Clock size={18} className="text-[#86868b]" /> Still stuck after a review?
        </h2>
        <p className="text-[#4b4b4f] dark:text-[#b0b0b5] text-[15px] leading-relaxed">
          If Account status says you&apos;re clear but MVP still can&apos;t post, disconnect Instagram in{' '}
          <Link href="/connect-socials" className="text-[#7C3AED] hover:underline font-medium">Connect Socials</Link> and connect it again from scratch.
          If it still fails, reach out on your <Link href="/support" className="text-[#7C3AED] hover:underline font-medium">Support</Link> page and we&apos;ll dig in.
        </p>
      </section>
    </div>
  )
}
