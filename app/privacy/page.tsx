// Privacy Policy. Rewritten 2026-10-05 for the YouTube API quota audit: it
// now meets YouTube API Developer Policies III.A.2 (uses YouTube API Services,
// links Google's Privacy Policy, what is accessed, stored, used and shared,
// device storage, revocation, contact) and states the retention MVP actually
// enforces (lib/youtube-retention). Every sentence here has to stay true of
// the product: scripts/test-privacy-policy holds the YouTube parts to the code.
export const metadata = { title: 'Privacy Policy · MVP Affiliate' }

const H2 = 'text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2'
const A = 'text-[#7C3AED] hover:underline'

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: October 5, 2026</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] dark:text-[#d1d1d6] leading-relaxed">

        <div>
          <h2 className={H2}>1. About This App</h2>
          <p>
            MVP Affiliate (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;) is a SaaS tool used by individual
            content creators (Amazon influencers, YouTubers, bloggers and affiliate marketers) to create, publish
            and distribute product review content on their own websites, YouTube channels, Amazon storefronts and
            social accounts. The App is operated by Gominplanet Holdings Ltd, an exempted company incorporated in
            Anguilla, British West Indies under the Business Companies Act, 2022 (company no. A000003427),
            registered office: The Hansa Bank Building, 1st Floor, PO Box 886, Landsome Road, The Valley, AI-2640,
            Anguilla, BWI (<a href="mailto:us@gominplanet.com" className={A}>us@gominplanet.com</a>).
          </p>
        </div>

        <div>
          <h2 className={H2}>2. Data We Collect</h2>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Account email address and name (provided at signup).</li>
            <li>Brand profile information you enter (brand name, bio, logo, niche, social links, contact email) and your writing voice samples.</li>
            <li>Photos you upload to create face models for your thumbnails and designs.</li>
            <li>Videos you upload or produce in the App, and the products (Amazon ASINs, links) you work with.</li>
            <li>Details of the accounts you connect (for example your YouTube channel ID and name, your WordPress site address), and their access tokens, stored encrypted.</li>
            <li>Content the App creates for you and its publishing history (posts, designs, comments, schedules).</li>
            <li>Usage of the App&apos;s features, counted to apply your plan&apos;s limits.</li>
            <li>Billing details are handled by Stripe; we do not store your card number.</li>
          </ul>
        </div>

        <div>
          <h2 className={H2}>3. Google and YouTube Data</h2>
          <p>
            MVP Affiliate uses <strong>YouTube API Services</strong>. By connecting your YouTube channel you also
            agree to the{' '}
            <a href="https://www.youtube.com/t/terms" className={A} target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>,
            and Google&apos;s handling of your data is described in the{' '}
            <a href="http://www.google.com/policies/privacy" className={A} target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
          </p>
          <p className="mt-3"><strong>What we access.</strong> When you sign in with Google to connect your channel, you choose which access to grant:</p>
          <ul className="list-disc ml-5 space-y-1 mt-2">
            <li><strong>https://www.googleapis.com/auth/youtube.force-ssl</strong>: to read your own channel and videos (title, description, tags, thumbnail, privacy status, schedule, view count and captions), to update the title, description, tags, thumbnail, playlist, privacy or schedule of your own videos, and to post and edit comments from your own channel on your own videos.</li>
            <li><strong>https://www.googleapis.com/auth/youtube.upload</strong>: to upload videos you produced or chose in the App to your own channel.</li>
          </ul>
          <p className="mt-3"><strong>What we do with it, and when.</strong> The App acts only on your own channel, and only for the features you use:</p>
          <ul className="list-disc ml-5 space-y-1 mt-2">
            <li>Write titles, descriptions and tags for your videos, and apply them when you click Apply.</li>
            <li>Upload the videos you add to a Bulk Amazon upload batch, at the time you scheduled, once you press Launch.</li>
            <li>Post the first comment with your product link on your videos when they go public, and a comment when a product you reviewed goes on sale, if you turned these on.</li>
            <li>Read your videos and their captions so the App can write accurate blog posts, descriptions and clips from what you said.</li>
          </ul>
          <p className="mt-3">
            Some of these run in the background after you set them up (a scheduled upload, a comment waiting for a
            video to go public). Nothing is published that you did not create, choose or schedule, and the App never
            reads, posts to or changes any channel other than the one you connected.
          </p>
          <p className="mt-3"><strong>What we store.</strong> Your channel ID and name, your encrypted access tokens, and for your videos: the video ID, title, description, thumbnail link, view count and transcript, plus the comments and changes the App made for you.</p>
          <p className="mt-3">
            <strong>Who we share it with.</strong> We do not sell, rent or share YouTube data with third parties for
            their own use, and we never use it for advertising. To write your titles, descriptions, posts and
            clips, the relevant text (for example a video&apos;s title, description or transcript) is processed by
            the AI providers listed in section 9, who act for us only to produce your content. Our use and transfer
            of information received from Google APIs adheres to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className={A} target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
            including the Limited Use requirements.
          </p>
          <p className="mt-3">
            <strong>How long we keep it.</strong> YouTube data stored about your videos is refreshed from YouTube at
            least every 30 days, or deleted. When you disconnect YouTube in the App, we revoke our access at Google
            and delete your tokens and the stored YouTube data about your videos straight away. If you revoke access
            from your Google account instead, the stored YouTube data is deleted within 30 days.
          </p>
          <p className="mt-3">
            <strong>How to revoke access.</strong> Disconnect YouTube from the App&apos;s Settings at any time, or
            remove MVP Affiliate on Google&apos;s security settings page at{' '}
            <a href="https://security.google.com/settings/security/permissions" className={A} target="_blank" rel="noopener noreferrer">security.google.com/settings/security/permissions</a>.
          </p>
        </div>

        <div>
          <h2 className={H2}>4. Pinterest Data</h2>
          <p>
            When you connect your Pinterest business account, we use Pinterest&apos;s OAuth flow and request the
            minimum scopes needed for the features you use:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>boards:read</strong>: to list the boards on your own Pinterest account so you can choose where new Pins are saved.</li>
            <li><strong>boards:write</strong>: to create a new board, only when you ask for one inside the App.</li>
            <li><strong>pins:read</strong>: to show you metrics (impressions, saves, outbound clicks) for Pins the App published for you.</li>
            <li><strong>pins:write</strong>: to create Pins for your content when you publish one or schedule one for a time you choose.</li>
            <li><strong>user_accounts:read</strong>: to show which Pinterest account you connected.</li>
          </ul>
          <p className="mt-3">
            We do not sell or share your Pinterest data, use it for advertising or to train AI models, interact
            with other accounts, or store your Pinterest password. Tokens are stored encrypted. You can disconnect
            Pinterest in the App at any time, which deletes the stored token, or revoke access from your Pinterest
            account settings under &quot;Apps&quot;.
          </p>
        </div>

        <div>
          <h2 className={H2}>5. Facebook and Instagram Data</h2>
          <p>
            If you connect a Facebook Page or an Instagram professional account, we request only the scopes needed
            to list your Pages and accounts and to publish the posts, Reels and Stories you publish or schedule in the
            App. We do not read personal profile data and do not use Facebook or Instagram data for advertising. You
            can disconnect at any time from the App; we delete the stored access token on disconnection.
          </p>
        </div>

        <div>
          <h2 className={H2}>6. TikTok Data</h2>
          <p>
            When you connect your TikTok account, we use TikTok&apos;s OAuth flow and request the minimum scopes
            needed for the features you use:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>user.info.basic</strong>: to show which TikTok account you connected (open_id, display name and avatar only).</li>
            <li><strong>user.info.profile</strong>: to show your TikTok profile link, bio and verified status in the App.</li>
            <li><strong>video.upload</strong>: to send a video to your TikTok account as a draft for you to finish in the TikTok app, when you publish it in the App.</li>
            <li><strong>video.publish</strong>: to publish a video directly to your TikTok feed when you publish it in the App, with the caption, privacy and audience you chose.</li>
          </ul>
          <p className="mt-3">
            We do not sell or share your TikTok data, use it for advertising or to train AI models, interact with
            other accounts, or store your TikTok password. Tokens are stored encrypted and deleted when you
            disconnect. You can also revoke access in TikTok under &quot;Manage app permissions&quot;. Your use of
            TikTok features is also subject to the{' '}
            <a href="https://www.tiktok.com/legal/terms-of-service" className={A} target="_blank" rel="noopener noreferrer">TikTok Terms of Service</a>{' '}
            and the{' '}
            <a href="https://www.tiktok.com/legal/privacy-policy" className={A} target="_blank" rel="noopener noreferrer">TikTok Privacy Policy</a>.
          </p>
        </div>

        <div>
          <h2 className={H2}>7. How We Use Your Data</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>To create your content: blog posts, video titles and descriptions, thumbnails, social designs, clips and comments.</li>
            <li>To publish or schedule that content to the accounts you connected, when you publish it or for the time you chose.</li>
            <li>To show your content history, usage and results inside the App.</li>
            <li>To apply your plan&apos;s limits and bill your subscription.</li>
            <li>To send account emails (sign-in, receipts, notices about your account).</li>
          </ul>
          <p className="mt-3">
            We never publish anything you did not create, choose or schedule, and we do not sell your data.
          </p>
        </div>

        <div>
          <h2 className={H2}>8. Cookies and Data Stored on Your Device</h2>
          <p>The App stores and reads information on your device:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>Sign-in cookies</strong> that keep you logged in. These are required for the App to work.</li>
            <li><strong>Browser storage</strong> (local storage) for your preferences, such as theme, menu layout and pinned features.</li>
            <li><strong>Meta Pixel</strong> cookies (<code>_fbp</code>, <code>_fbc</code>) on our public pages, to measure our own advertising.</li>
            <li><strong>Rewardful</strong> cookies, to credit a referral to the affiliate who sent you.</li>
            <li>The optional SCOUT browser extension stores a link token in your browser (see section 12).</li>
          </ul>
          <p className="mt-3">
            The App does not let third parties serve advertisements inside it. You can clear cookies and browser
            storage from your browser settings; clearing sign-in cookies signs you out.
          </p>
        </div>

        <div>
          <h2 className={H2}>9. Service Providers</h2>
          <p>We use these providers to run the App. Each processes data only to provide its service to us:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Anthropic, OpenAI, Google (Gemini), fal.ai and ElevenLabs: AI processing to write text, transcribe audio and create images and voice for your content.</li>
            <li>Supabase: database and file storage (United States).</li>
            <li>Vercel: web hosting.</li>
            <li>Stripe: billing and subscriptions.</li>
            <li>Resend: account emails.</li>
            <li>The platforms you connect (YouTube, Pinterest, Facebook, Instagram, TikTok, WordPress and others), only to publish what you ask.</li>
          </ul>
        </div>

        <div>
          <h2 className={H2}>10. Data Storage and Security</h2>
          <p>
            Account data, content and integration credentials are stored in Supabase (PostgreSQL) on servers in the
            United States. Access tokens and other secrets are encrypted at rest. Access to production data is
            restricted to authorized personnel and protected by multi-factor authentication.
          </p>
        </div>

        <div>
          <h2 className={H2}>11. Data Retention and Deletion</h2>
          <p>
            We keep your data while your account is active, except YouTube data, which follows the timelines in
            section 3. To delete your account and all associated data, email{' '}
            <a href="mailto:us@gominplanet.com" className={A}>us@gominplanet.com</a>{' '}
            from the address registered to the account. We delete your account and all associated data, including
            every access token we hold for you, within 30 days of the request.
          </p>
        </div>

        <div>
          <h2 className={H2}>12. Browser Extension (SCOUT)</h2>
          <p>
            The optional &quot;SCOUT, MVP Affiliate&quot; Chrome extension carries out, in your own signed-in browser,
            the steps the App cannot do through an API. It acts only on your own accounts and only for tasks you
            start in the App:
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-1">
            <li>On Amazon Creator Connections and product pages: reads campaign and product details so you can choose campaigns and products to work with.</li>
            <li>On Amazon&apos;s creator upload pages: uploads the videos you queued to your own Amazon storefront.</li>
            <li>In YouTube Studio: uploads the videos you queued to your own channel, fills in their details, and posts and pins the comments you set up.</li>
            <li>On YouTube: captures frames from your videos for your thumbnails.</li>
            <li>Only if you grant the optional permission: prepares posts in your Facebook Groups for you to review. SCOUT never presses Post for you there.</li>
          </ul>
          <p className="mt-3">
            It stores a link token in your browser (<code>chrome.storage</code>) to connect to your MVP Affiliate
            account; the token stays on your device and is only sent to mvpaffiliate.io. It sends to the App only the
            results of the tasks you started. It does not read your browsing history, passwords or payment details,
            does not use analytics or advertising, and does not sell or share data. Its permissions
            (<code>activeTab</code>, <code>scripting</code>, <code>storage</code>, <code>tabs</code>,{' '}
            <code>downloads</code>, <code>alarms</code> and the listed sites) are limited to these tasks, and its use
            is consistent with the Chrome Web Store User Data policy, including the Limited Use requirements. You can
            remove it at any time from Chrome, which deletes its stored token.
          </p>
        </div>

        <div>
          <h2 className={H2}>13. Children</h2>
          <p>
            MVP Affiliate is not directed to anyone under the age of 16. We do not knowingly collect personal data
            from children. If you believe a child has provided us with personal data, contact us and we will delete it.
          </p>
        </div>

        <div>
          <h2 className={H2}>14. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy. The &quot;Last updated&quot; date at the top shows the most recent
            revision. Material changes are announced in the App or by email.
          </p>
        </div>

        <div>
          <h2 className={H2}>15. Contact</h2>
          <p>
            For privacy questions, complaints, deletion requests or anything else, contact us at{' '}
            <a href="mailto:us@gominplanet.com" className={A}>us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}
