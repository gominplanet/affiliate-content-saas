export const metadata = { title: 'Privacy Policy — MVP Affiliate' }

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-[#1d1d1f] dark:text-[#f5f5f7]">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[#86868b] dark:text-[#8e8e93] mb-10">Last updated: May 13, 2026</p>

      <section className="prose prose-sm max-w-none space-y-8 text-[#374151] leading-relaxed">

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">1. About This App</h2>
          <p>
            MVP Affiliate (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;) is a SaaS tool used by individual
            content creators (bloggers, YouTubers, affiliate marketers) to generate, publish, and distribute
            product review content to their own websites and social accounts. The App is operated by
            Gominplanet Holdings Ltd, an exempted company incorporated in Anguilla, British West Indies under the
            Business Companies Act, 2022 (company no. A000003427), registered office: The Hansa Bank Building, 1st Floor,
            PO Box 886, Landsome Road, The Valley, AI-2640, Anguilla, BWI
            (<a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>).
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">2. Data We Collect From You</h2>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Account email address and name (provided at signup)</li>
            <li>Brand profile information you enter (brand name, bio, logo, social URLs, contact email)</li>
            <li>YouTube channel ID (provided by you)</li>
            <li>WordPress site URL and Application Password (provided by you, stored encrypted)</li>
            <li>Generated blog content and publishing history</li>
            <li>Analytics on content the App has produced for you (post counts, publishing dates)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">3. Pinterest Data</h2>
          <p>
            When you connect your Pinterest business account to MVP Affiliate, we use Pinterest&apos;s OAuth
            flow and request the minimum scopes needed for the features you use. Specifically:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>boards:read</strong> — to list the boards on your own Pinterest account so you can choose where new Pins are saved.</li>
            <li><strong>boards:write</strong> — to create a new board on your behalf, only when you explicitly request one inside the App.</li>
            <li><strong>pins:read</strong> — to retrieve metrics (impressions, saves, outbound clicks) for Pins the App has helped you publish, shown back to you inside the App.</li>
            <li><strong>pins:write</strong> — to create new Pins linking to review articles you have published through MVP Affiliate. Pins are only created when you explicitly click a publish action; no Pin is ever created in the background.</li>
            <li><strong>user_accounts:read</strong> — to identify which Pinterest account you have connected so the App can display &quot;Connected as @yourhandle&quot; in the settings UI.</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong>:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Sell, rent, share, or transfer your Pinterest data to any third party.</li>
            <li>Use your Pinterest data for advertising or to train AI models.</li>
            <li>Read, follow, save, or interact with content on Pinterest accounts other than your own.</li>
            <li>Bulk-create, automate engagement on, or schedule Pins outside of explicit user actions.</li>
            <li>Store your Pinterest password — we use OAuth tokens only, encrypted at rest.</li>
          </ul>
          <p className="mt-3">
            Pinterest access tokens are stored encrypted in our database. You can disconnect Pinterest at
            any time from the Settings page in the App, which immediately revokes and deletes the stored
            token. You can also revoke MVP Affiliate&apos;s access directly from your Pinterest account
            settings under &quot;Apps&quot;.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">4. Facebook Data</h2>
          <p>
            If you connect a Facebook Page, we request only the scopes needed to list your Pages
            (<strong>pages_show_list</strong>) and publish a post when you explicitly click the
            &quot;Post to Facebook&quot; button (<strong>pages_manage_posts</strong>). We do not post in the
            background, do not read personal profile data, and do not use Facebook data for advertising.
            You can disconnect at any time from the Settings page; we delete the stored access token on
            disconnection.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">5. Google / YouTube Data</h2>
          <p>
            If you connect your YouTube channel, MVP Affiliate uses YouTube API Services. We
            request only the scopes needed to read <strong>your own</strong> channel and videos
            and, <strong>only when you explicitly click an action</strong> (such as
            &quot;Apply&quot; or &quot;Save as draft&quot;), to update the title, description,
            tags, thumbnail, privacy or schedule on <strong>your own</strong> videos:
          </p>
          <ul className="list-disc ml-5 space-y-1 mt-2">
            <li><strong>https://www.googleapis.com/auth/youtube</strong> — read your channel/videos and update your own video metadata, thumbnail, privacy and schedule.</li>
            <li><strong>https://www.googleapis.com/auth/youtube.force-ssl</strong> — perform those same read/update operations over a secure connection, as required by the YouTube Data API.</li>
          </ul>
          <p className="mt-3">
            We never access channels other than the authenticated user&apos;s own, never post or
            change anything in the background, and never use YouTube data for advertising or to
            train AI/ML models. You can revoke access at any time from the App&apos;s Settings page
            (we delete the stored tokens on disconnection) and via your Google Account at{' '}
            <a href="https://myaccount.google.com/permissions" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
          </p>
          <p className="mt-3">
            MVP Affiliate&apos;s use and transfer of information received from Google APIs to any
            other app will adhere to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
            including the Limited Use requirements. Your use of YouTube features is also subject to
            the{' '}
            <a href="https://www.youtube.com/t/terms" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>{' '}
            and the{' '}
            <a href="https://policies.google.com/privacy" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">6. TikTok Data</h2>
          <p>
            When you connect your TikTok account to MVP Affiliate, we use TikTok&apos;s OAuth flow and
            request the minimum scopes needed for the features you use. Specifically:
          </p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>user.info.basic</strong> — to identify which TikTok account you have connected and display &quot;Connected as @yourhandle&quot; in the App&apos;s Settings page. Provides open_id, display name and avatar only.</li>
            <li><strong>user.info.profile</strong> — to display your TikTok profile link, bio, and verified status in the App&apos;s Settings page.</li>
            <li><strong>video.upload</strong> — to upload a video to your authorized TikTok account as a draft for you to finalize from the TikTok app, only when you explicitly click a publish action in MVP Affiliate.</li>
            <li><strong>video.publish</strong> — to publish a video directly to your authorized TikTok feed, only when you explicitly click a publish action in MVP Affiliate. The caption, privacy setting, and audience are chosen by you inside MVP Affiliate before the request is sent.</li>
          </ul>
          <p className="mt-3">We do <strong>not</strong>:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Sell, rent, share, or transfer your TikTok data to any third party.</li>
            <li>Use your TikTok data for advertising or to train AI/ML models.</li>
            <li>Read, follow, like, comment on, or interact with TikTok content from accounts other than your own.</li>
            <li>Post, schedule, or bulk-create content on your TikTok account outside of explicit user actions.</li>
            <li>Store your TikTok password — we use OAuth tokens only, encrypted at rest.</li>
          </ul>
          <p className="mt-3">
            TikTok access tokens are stored encrypted in our database. You can disconnect TikTok at
            any time from the Settings page in the App, which immediately deletes the stored token.
            You can also revoke MVP Affiliate&apos;s access directly from your TikTok account settings
            under &quot;Manage app permissions&quot;. Your use of TikTok features is also subject to the{' '}
            <a href="https://www.tiktok.com/legal/terms-of-service" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">TikTok Terms of Service</a>{' '}
            and the{' '}
            <a href="https://www.tiktok.com/legal/privacy-policy" className="text-[#0071e3] hover:underline" target="_blank" rel="noopener noreferrer">TikTok Privacy Policy</a>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">7. How We Use Your Data</h2>
          <ul className="list-disc ml-5 space-y-1">
            <li>To generate blog posts from your inputs (product URLs, YouTube videos, etc.)</li>
            <li>To publish posts to your WordPress site</li>
            <li>To create Pins or social posts on platforms you have explicitly connected, only when you trigger a publish action</li>
            <li>To display your content history and analytics inside the App</li>
            <li>To send transactional account emails (login confirmations, billing receipts)</li>
          </ul>
          <p className="mt-3">
            We never publish anything on your behalf without a direct, explicit user action. There is no
            background scheduling, no automated bulk distribution, and no &quot;set and forget&quot; posting.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">8. Data Storage and Security</h2>
          <p>
            Account data, content, and integration credentials are stored in Supabase (PostgreSQL) on
            servers in the United States. OAuth access tokens and other secrets are stored encrypted at
            rest. Access to production data is restricted to authorized personnel and protected by
            multi-factor authentication.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">9. Data Retention and Deletion</h2>
          <p>
            We retain your data for as long as your account is active. To delete your account and all
            associated data, email{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>{' '}
            from the address registered to the account. We will delete your account and all associated
            data within 30 days of receiving the request, including any Pinterest, Facebook, and other
            third-party tokens we hold for you.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">10. Third-Party Services</h2>
          <p>MVP Affiliate integrates with the following services on your behalf:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Pinterest (Pin creation and analytics — only the connected business account)</li>
            <li>Facebook / Meta (Page posting — only Pages you authorize)</li>
            <li>TikTok (video posting — only the connected account, only on explicit user action)</li>
            <li>YouTube Data API (channel and video data)</li>
            <li>WordPress REST API (publishing to your own self-hosted WordPress site)</li>
            <li>Large-language-model providers used to power our AI agent pipeline (content generation)</li>
            <li>Supabase (data storage)</li>
            <li>Stripe (billing and subscription management)</li>
            <li>Vercel (web hosting)</li>
          </ul>
          <p className="mt-3">Each service&apos;s own privacy policy governs their handling of your data.</p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">11. Children</h2>
          <p>
            MVP Affiliate is not directed to anyone under the age of 16. We do not knowingly collect
            personal data from children. If you believe a child has provided us with personal data,
            contact us and we will delete it.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">12. Browser Extension (CC Scout)</h2>
          <p>
            The optional &quot;MVP Affiliate — CC Scout&quot; Chrome extension has a single purpose: to
            help you find Amazon Creator Connections campaigns and queue the ones you choose into
            your own MVP Affiliate account. It is not required to use MVP Affiliate.
          </p>
          <p className="mt-3">What it accesses, and only when you open it on the relevant page:</p>
          <ul className="list-disc ml-5 space-y-1 mt-1">
            <li>It reads campaign listing data (product ASINs, commission/EPC, budget, available slots) from the Amazon Creator Connections page you are already viewing in your own logged-in Amazon session. It runs only on <strong>affiliate-program.amazon.com</strong> and <strong>amazon.com/creatorconnections</strong> pages, plus mvpaffiliate.io.</li>
            <li>It stores a single MVP Affiliate link token locally in your browser (<code>chrome.storage</code>) so the extension can attach campaigns to your account. The token stays on your device and is only sent to mvpaffiliate.io.</li>
            <li>When you click to push campaigns, it transmits only the campaign identifiers/metadata you selected to your own MVP Affiliate account.</li>
          </ul>
          <p className="mt-3">
            The extension does <strong>not</strong> read other tabs, browsing history, your Amazon
            credentials, or payment data; does not run in the background; does not use analytics or
            advertising; and does not sell or share data with third parties. Its permissions
            (<code>activeTab</code>, <code>scripting</code>, <code>storage</code>, and the host
            permissions above) are the minimum needed for this single purpose. Use of the extension
            is consistent with the Chrome Web Store User Data policy, including its Limited Use
            requirements. You can remove the extension at any time from Chrome; doing so deletes its
            locally stored token.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">13. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy. The &quot;Last updated&quot; date at the top reflects the
            most recent revision. Material changes will be announced via an in-app notice or email.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">14. Contact</h2>
          <p>
            For privacy questions, deletion requests, or any other concerns, contact us at{' '}
            <a href="mailto:us@gominplanet.com" className="text-[#0071e3] hover:underline">us@gominplanet.com</a>.
          </p>
        </div>

      </section>
    </main>
  )
}
