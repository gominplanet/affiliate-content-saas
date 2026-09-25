'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-tool guide content. Each export is a thin, self-contained wrapper around
// <ToolGuide> for one page. A page adds its guide by passing the component to
// PageHero's `guide` slot, e.g. `guide={<AmzFinderGuide />}`. All copy uses
// colons/semicolons, no em-dashes.

import ToolGuide from '@/components/guide/ToolGuide'
// The Shorts cap is READ, never typed: this line is what a creator is shown
// when they ask what their limit is, and it sat at 50 while the constant moved.
import { SHORTS_MONTHLY_CAP } from '@/lib/usage-cap'
import {
  ShoppingBag, Sparkles, Search, Tag, ShoppingCart, PenLine, Bookmark, ShieldCheck,
  Youtube, Image as ImageIcon, Type, FileText, Layers, Send, Mail, Link2, Scale,
  BookOpen, Palette, Mic, UserSquare, Rocket, TrendingUp, Store, Megaphone, Video,
  Lightbulb, BarChart3, MessageCircle, Handshake, Wrench, MousePointerClick,
  Zap, Scissors, Users, Inbox, Clock, KeyRound, Instagram,
  RefreshCw, ListChecks, Download, Eye, Globe, Camera, Shirt, Trash2, Brain, Upload,
  Calendar, Trophy, Table2, Signpost, Gauge, Wand2, Bot, Star, Smartphone,
} from 'lucide-react'
import { FREE_TRIAL } from '@/lib/free-trial'

// ── AMZ Product Finder ───────────────────────────────────────────────────────
export function AmzFinderGuide() {
  return (
    <ToolGuide
      guideKey="amz-finder"
      version={2}
      icon={<ShoppingBag size={20} />}
      title="Your guide to Amazon Product Research"
      subtitle="Search the whole Amazon catalogue, then save and review the winners."
      sections={[
        { icon: <Search size={18} />, title: 'Search the whole catalogue', body: <>Type a keyword or pick a filter: <strong>category</strong>, star rating, review count, best-seller rank, and a min and max price. Sort by best sellers, most reviews, rating, or price, and use <strong>Load more products</strong> to keep going.</> },
        { icon: <Clock size={18} />, title: 'Free to research', body: <>Searching is free on every plan. On the free plan you press <strong>Search</strong> to apply changes, up to {FREE_TRIAL.researchSearchesPerDay} searches a day. Paid plans search live as you change filters and unlock <strong>Save</strong>, <strong>Write review</strong>, <strong>Data</strong> and <strong>MVP picks</strong>.</> },
        { icon: <Sparkles size={18} />, title: 'MVP picks', body: <>Turn on <strong>MVP picks</strong> to see only products that clear MVP&rsquo;s buy-to-review rules: price, rating and review floors, real monthly demand, and an open video carousel on the product page. Every pick is checked, so results take longer. Tap <strong>What&rsquo;s this?</strong> beside it for the full explanation.</> },
        { icon: <BarChart3 size={18} />, title: 'Check the data first', body: <>Each card shows the price, rating, reviews, monthly sales and best-seller rank where Amazon has them. Tap <strong>Data</strong> for the deep dive: price against its typical and all-time low, recent sales, carousel videos, and seller details, with a <strong>Write review</strong> button at the end.</> },
        { icon: <PenLine size={18} />, title: 'Write a review in one click', body: <><strong>Write review</strong> researches the product, writes a full review in your voice, and publishes it to your WordPress with your affiliate link. When it finishes, the button turns into <strong>View review</strong>.</> },
        { icon: <ShoppingCart size={18} />, title: 'Buy to review vs your affiliate link', body: <>The green <strong>cart</strong> button is a plain Amazon link with no tag, for buying the product yourself (you cannot earn commission on your own purchase). Every other product link carries your own Associates tag, which you set once in <strong>Brand Profile</strong>.</> },
        { icon: <Bookmark size={18} />, title: 'Save for later', body: <>Hit <strong>Save</strong> and the product lands on your <strong>Saved for later</strong> shelf below, your buy-to-review shortlist. From there you can <strong>Buy to review</strong> or <strong>Remove</strong> it; items you saved from CC Campaigns also get <strong>Message brand</strong>.</> },
        { icon: <Lightbulb size={18} />, title: 'Made for your channel', body: <>When MVP has matches for you, a <strong>Made for your channel</strong> strip sits above the search. Open it to see products matched to what already earns for you, each with the reasons it matched. Until your storefront earnings sync, it shows <strong>Trending picks to try</strong> instead.</> },
      ]}
      footerNote={<><strong className="text-foreground">Looking for Creator Connections campaigns?</strong> They have their own <strong className="text-foreground">CC Campaigns</strong> page under Research.</>}
    />
  )
}

// ── YouTube Co-Pilot ─────────────────────────────────────────────────────────
export function CoPilotGuide() {
  return (
    <ToolGuide
      guideKey="co-pilot"
      version={2}
      accent="#FF0000"
      icon={<Youtube size={20} />}
      title="Your guide to YouTube Co-Pilot"
      subtitle="Write a video's metadata and thumbnail, push it to YouTube, and let SCOUT finish it in Studio."
      sections={[
        { icon: <Calendar size={18} />, title: 'Your videos and calendar', body: <>Fresh uploads wait under <strong>Needs metadata</strong>. Anything MVP has written for, or that is already scheduled or live, moves to <strong>Metadata sent</strong>; tick <strong>Include published</strong> to redo a live video. Press <strong>Yes, show my YouTube schedule</strong> once for a month calendar of scheduled (purple) and published (green) videos, then click a day and a video to jump to its card.</> },
        { icon: <Tag size={18} />, title: 'Set the product', body: <>Put the ASIN in the title or file name and the orange <strong>ASIN</strong> pill confirms MVP found it. If the title has no ASIN, press <strong>+ Set the product</strong> on the card and paste the Amazon link or ASIN. If MVP found the wrong one, use <strong>Wrong? Fix it</strong>. Either way, <strong>Rewrite for this product</strong> writes the metadata again around it, and every generator on the card uses that product.</> },
        { icon: <Type size={18} />, title: 'Titles, description and tags', body: <><strong>Generate YouTube metadata</strong> writes a title with alternatives, a full description with your affiliate link near the top, tags, and a pinned comment to post once the video is live. If SCOUT is installed, it reads the video&rsquo;s transcript first so the copy matches what you said. If you rewrite one of MVP&rsquo;s standard description lines, <strong>Save as default</strong> keeps your wording for every future video.</> },
        { icon: <ImageIcon size={18} />, title: 'Thumbnails with MVP Art Director', body: <>Choose who is in the video under <strong>Who&rsquo;s in this video?</strong> (faces come from Photobooth), add <strong>Quick style</strong> touches like Question hook, Badge or Wear it, and <strong>Match a look</strong> you saved. <strong>Create my MVP Thumbnail</strong> uses SCOUT to capture real frames from your video; without SCOUT, use <strong>Product Only</strong> or <strong>Upload My Design</strong>. A thumbnail you already made for this product, in the Thumbnail Generator or an earlier run, shows up first with <strong>Use it</strong>.</> },
        { icon: <Send size={18} />, title: 'Push it to YouTube', body: <>The red button sends the title, description, tags and thumbnail on every plan. Its label is <strong>Save Draft to YouTube</strong>, <strong>Schedule on YouTube</strong> or <strong>Push to YouTube</strong>, depending on your settings. On Pro, <strong>Studio Settings</strong> adds a playlist, visibility, a schedule, Made for kids and Notify subscribers (No unless you pick Yes). The push also sets <strong>Paid promotion: Yes</strong> and <strong>AI use: No</strong> through YouTube, and nothing is scheduled or made public until paid promotion reads back as Yes.</> },
        { icon: <Zap size={18} />, title: 'SCOUT finishes it in Studio', body: <>On Pro with SCOUT installed, the same click carries on in YouTube Studio in your own browser. SCOUT turns <strong>monetization On</strong>, submits the <strong>ad suitability rating</strong>, tags the product when one is set, and adds the <strong>end screen</strong> from your latest video. Then it applies your schedule or visibility, reading each step back off the page, so there is nothing left to finish by hand.</> },
        { icon: <ShieldCheck size={18} />, title: 'On YouTube now', body: <>After the push, this card shows what YouTube and Studio actually report, not what was sent. Paid promotion and AI use each get a tick, a cross or a question mark, and each SCOUT step shows as done, did not work, not needed or not reached. If SCOUT could not finish, <strong>Run SCOUT again</strong> retries with the same time you pushed; <strong>See in YouTube Studio</strong> opens the video, and <strong>Dismiss</strong> moves it to Metadata sent.</> },
        { icon: <UserSquare size={18} />, title: 'Faces come from Photobooth', body: <>To put yourself on a thumbnail, add your face in <strong>Photobooth</strong> first; it then appears under Who&rsquo;s in this video. With no face trained, pick <strong>No face</strong> or <strong>Product Only</strong> for a product scene.</> },
      ]}
      footerNote={<><strong className="text-foreground">SCOUT is the MVP Chrome extension.</strong> It reads transcripts, captures video frames and does the Studio-only steps. Without it the push still works, and the card tells you which steps were not done.</>}
    />
  )
}

// ── Blog Post Generator ──────────────────────────────────────────────────────
export function ContentGuide() {
  return (
    <ToolGuide
      guideKey="content"
      version={2}
      icon={<FileText size={20} />}
      title="Your guide to the Blog Post Generator"
      subtitle="Turn your YouTube videos, or a product link, into published reviews, then share them."
      sections={[
        { icon: <Youtube size={18} />, title: 'Video to Blog', body: <>Press <strong>Sync videos</strong> to pull in your YouTube videos. Any video on your channel works, even old ones. On a video, choose <strong>Generate now</strong> to set options and write the post, or <strong>Schedule for later</strong> to pick a date, a time and which socials to post to.</> },
        { icon: <FileText size={18} />, title: 'What goes into a post', body: <>MVP reads the video and its transcript and writes a first-person review in your voice, learned from your videos and published posts. It uses the real product specs, never invented ones. The post publishes to your WordPress with SEO built in: target keyword, meta description, internal links, schema, an FAQ and the affiliate disclosure.</> },
        { icon: <Link2 size={18} />, title: 'Your link, built for you', body: <>MVP takes the product link from your video description, rebuilds it in the link style you chose in Brand Profile, and falls back to your Amazon tag if needed. A direct brand or store link works too, so non-Amazon products are covered. If there is no link at all, MVP identifies the product from your title and transcript.</> },
        { icon: <Sparkles size={18} />, title: 'No video? Start from a link', body: <><strong>New post from a link</strong> takes any product or service link, or an Amazon ASIN, then researches, writes and publishes a post with no video needed. Fill in <strong>What happened when you used it</strong> so the post can speak from your own experience. Once it is live, it shows under <strong>Blog to Social</strong>.</> },
        { icon: <Wrench size={18} />, title: 'Post settings and tools', body: <>Before you generate, you can tick <strong>Include photos in the article</strong>, pick a category, add extra keywords or upload your own hero image; all optional. Once a post is live, edit it inside MVP, swap its thumbnail, or press <strong>Update my post thumbnail with Art Director</strong> for a new one without touching the article. On Pro, <strong>Rewrite</strong> writes the post again with your feedback.</> },
        { icon: <Send size={18} />, title: 'Blog to Social', body: <>This tab is your whole live blog. Push any post to your connected Facebook, X, LinkedIn, Threads, Bluesky, Telegram and Pinterest from its card and re-share it any time; <strong>Hide shared</strong> tucks away posts already sent everywhere. <strong>Share with brand</strong> builds a recap of everywhere the content is live, ready to copy, email or send on Creator Connections.</> },
        { icon: <Clock size={18} />, title: 'Scheduled and Auto-pilot', body: <>The <strong>Scheduled</strong> tab lists queued posts, and they go out on time even when your computer is off. <strong>Auto-pilot</strong> turns your next un-blogged video into a post on the days you pick, up to one a day from your monthly allowance. It can also post each one to the socials you choose.</> },
        { icon: <ShieldCheck size={18} />, title: 'Keep the blog tidy', body: <><strong>Fix Categories</strong> shows the category each post will get before you apply it. <strong>Fix Affiliate Links</strong> finds buy links that are broken or not in your chosen link style and repairs them. <strong>Link settings</strong> chooses whether Facebook, LinkedIn and Bluesky posts point to the blog, the affiliate link, or both.</> },
      ]}
    />
  )
}

// ── Comparisons ──────────────────────────────────────────────────────────────
export function ComparisonGuide() {
  return (
    <ToolGuide
      guideKey="comparison"
      version={2}
      icon={<Scale size={20} />}
      title="Your guide to Comparisons"
      subtitle="Head-to-head 'X vs Y' posts with a named winner, built from your videos."
      sections={[
        { icon: <Scale size={18} />, title: 'Why comparison posts convert', body: <>Someone searching &ldquo;X vs Y&rdquo; is close to buying; they just need help deciding. These posts capture that high-intent traffic, and every product in the post carries your affiliate link.</> },
        { icon: <Youtube size={18} />, title: 'Paste the videos', body: <>Add 2 to 10 YouTube video links, one product per video; <strong>Add another product</strong> gives you more rows. <strong>Topic / title</strong> is optional; MVP works it out from the videos.</> },
        { icon: <Trophy size={18} />, title: 'A ranked verdict with a winner', body: <>MVP ranks the products from best to worst and names a clear #1, with headings like Best Overall or Best Value. A quick-verdict box at the top says why the winner wins, and each product gets its own write-up and verdict line.</> },
        { icon: <Table2 size={18} />, title: 'A table that stays accurate', body: <>The comparison table lists the features that actually separate the products. A product is only marked as having a feature when its product data or its video shows it, and unclear ones are marked partial.</> },
        { icon: <ImageIcon size={18} />, title: 'Hero image and videos', body: <>If you leave <strong>Hero image</strong> blank, MVP makes one: a head-to-head image of the real products when it finds two clean product shots, otherwise a themed image for the category. You can also <strong>Upload your own</strong> (JPG, PNG or WebP under 8 MB). Each product&rsquo;s video is embedded under its heading.</> },
        { icon: <Layers size={18} />, title: 'Videos from other channels', body: <>You can compare products from videos you did not film. Those products are written up as research, never as a hands-on test, and the original creator is credited under the video.</> },
        { icon: <Send size={18} />, title: 'Links and publishing', body: <>Every product links out with your affiliate link in the link style you chose. If you run more than one site, pick it under <strong>Publish to</strong>. The post goes live on WordPress and counts as one post.</> },
      ]}
      footerNote={<><strong className="text-foreground">Comparisons are part of the Pro plan.</strong> For &ldquo;Best [thing]&rdquo; roundups, use Buying Guides.</>}
    />
  )
}

// ── Buying Guides ────────────────────────────────────────────────────────────
export function BuyingGuidesGuide() {
  return (
    <ToolGuide
      guideKey="buying-guides"
      version={2}
      icon={<BookOpen size={20} />}
      title="Your guide to Buying Guides"
      subtitle="'Best [thing] for [use case]' roundups that rank and earn."
      sections={[
        { icon: <BookOpen size={18} />, title: 'The workhorse of affiliate SEO', body: <>&ldquo;Best budget X&rdquo;, &ldquo;best X for beginners&rdquo;: these roundup posts pull steady search traffic and link out to several products, so one article can earn from many sales.</> },
        { icon: <Layers size={18} />, title: 'Two ways to build one', body: <><strong>Pick from my catalogue</strong> builds the guide from reviews already on your blog. <strong>Pick my own</strong> takes 2 to 10 YouTube video links, one product per video, and works from day one.</> },
        { icon: <Search size={18} />, title: 'Pick from my catalogue', body: <>Type a topic, or tap one of the <strong>Suggested topics from your library</strong>: phrases shared by three or more of your reviews. MVP picks the 5 to 7 reviews that fit best and labels each one, such as Best Overall, Best on a Budget or Best for a specific use. This mode unlocks once your blog has 500 published posts.</> },
        { icon: <Eye size={18} />, title: 'Full auto or Let me see', body: <><strong>Full auto</strong> writes and publishes straight away. <strong>Let me see</strong> shows the picks first so you can rename a label or remove a pick, then publish; a guide needs at least 3 picks.</> },
        { icon: <ListChecks size={18} />, title: 'Pick my own', body: <>Paste the videos and an optional topic. MVP works out each product, ranks them into a &ldquo;best for&rdquo; guide and publishes it. If you already published a guide from the same videos, MVP points you to that post instead of making a second one.</> },
        { icon: <FileText size={18} />, title: 'What a catalogue guide contains', body: <>A short recap, a quick picks table with a <strong>Read full review</strong> link for each pick, a section per pick that names its trade-off, and an FAQ. Every guide is tagged <strong>buying-guide</strong> in WordPress, so it is easy to filter.</> },
        { icon: <RefreshCw size={18} />, title: 'Keep it fresh', body: <>Under <strong>Recent guides</strong>, <strong>Rebuild</strong> refreshes a video-built guide&rsquo;s product links, hero image and call to action at the same URL, so the post keeps its search history. You can also view or delete any guide from there.</> },
        { icon: <TrendingUp size={18} />, title: 'Topics people already search', body: <>With Search Console connected, <strong>Search demand you&rsquo;re missing</strong> on the SEO & Indexing page lists searches your site already shows up for but no post targets. Opening one starts a guide here with that topic filled in.</> },
      ]}
      footerNote={<><strong className="text-foreground">Buying Guides are part of the Pro plan.</strong></>}
    />
  )
}

// ── MVP x LTK ────────────────────────────────────────────────────────────────
export function LtkGuide() {
  return (
    <ToolGuide
      guideKey="ltk"
      version={2}
      icon={<Sparkles size={20} />}
      title="Your guide to MVP x LTK"
      subtitle="Turn one LTK link into a blog post that sends shoppers to your LTK shop."
      sections={[
        { icon: <Link2 size={18} />, title: 'Bring your own LTK link', body: <>Paste your commissionable LTK link (a liketk.it or shopltk.com link from your LTK app) into <strong>Your LTK link</strong>. LTK has no public API, so MVP never logs in, reads your shop, or posts on LTK; you bring one link at a time.</> },
        { icon: <Sparkles size={18} />, title: 'Auto-fill, then add your notes', body: <>When you leave the link field, MVP tries to read the product name and image from your link and fills only the fields you left empty. Check the <strong>Product name</strong> (required) and add <strong>A few details</strong> in your own words; they are what make the post yours.</> },
        { icon: <Layers size={18} />, title: 'Shop the Post widget (optional)', body: <>Paste the WordPress HTML from your LTK Creator dashboard (<strong>Tools</strong>, then <strong>Shop the Post</strong>) to embed your live, shoppable gallery instead of a plain button. Some hosts and security plugins strip scripts, so add your LTK link too as a fallback. <strong>How do I get this code?</strong> shows the steps.</> },
        { icon: <FileText size={18} />, title: 'What MVP writes', body: <><strong>Generate post</strong> runs a quick web research pass, writes a fact-grounded review in your brand voice, and builds a hero image. Your LTK link becomes the <strong>Shop it on LTK</strong> button plus a few inline links.</> },
        { icon: <ShieldCheck size={18} />, title: 'Your link stays untouched', body: <>MVP uses your LTK link exactly as you pasted it, with no cloaking or redirect, so LTK&rsquo;s tracking and your commission stay intact.</> },
        { icon: <Send size={18} />, title: 'Draft or live', body: <>Leave <strong>Publish live now</strong> off to save a WordPress draft, or tick it to publish straight away. When it is done you get <strong>View post</strong> and <strong>Edit in WP</strong> links, and the post is saved with your other MVP posts.</> },
        { icon: <TrendingUp size={18} />, title: 'Why this helps', body: <>LTK pages do not rank in Google on their own. A real blog post gives your pick a searchable home that sends readers to your LTK shop.</> },
      ]}
      footerNote={<><strong className="text-foreground">Before you start:</strong> connect a WordPress site and save your Brand Profile. MVP x LTK is included on every paid plan.</>}
    />
  )
}

// ── Scriptwriter ─────────────────────────────────────────────────────────────
export function ScriptwriterGuide() {
  return (
    <ToolGuide
      guideKey="script"
      version={2}
      icon={<PenLine size={20} />}
      title="Your guide to Scriptwriter"
      subtitle="Film-ready review scripts and shot lists, in your voice."
      sections={[
        { icon: <ShoppingBag size={18} />, title: 'Start with the product', body: <>Paste an Amazon ASIN, an Amazon or Geniuslink URL, or any product page link. MVP pulls the real product info, so the script sticks to actual features instead of invented specs.</> },
        { icon: <Video size={18} />, title: 'Pick a style', body: <><strong>Hands-On Test</strong> is a 3 to 6 minute video for the moment someone is deciding. <strong>Long-Term Review</strong> runs 8 to 12 minutes, after weeks of use, and covers how the build held up.</> },
        { icon: <Lightbulb size={18} />, title: 'Three hooks to choose from', body: <>Every script comes with three opening hooks: problem first, a question, and a trade-off tease. Tap one to lock it in for filming, and the hook section updates to match.</> },
        { icon: <PenLine size={18} />, title: 'Scripted where it counts', body: <>Sections marked <strong>Scripted</strong>, such as the hook, the verdict and the close, are written word for word. <strong>Improvised</strong> sections give you talking points instead, so the middle sounds natural on camera.</> },
        { icon: <Camera size={18} />, title: 'A shot list for each section', body: <>Every section lists what to film: the subject only, with no lighting or director notes. Each section shows its target length, and the header shows the total runtime.</> },
        { icon: <Smartphone size={18} />, title: 'A vertical short, written fresh', body: <>Both styles include a vertical short for TikTok, Reels and YouTube Shorts, with its own hook, script and shots. It is written from scratch, not cut down from the long version.</> },
        { icon: <Mic size={18} />, title: 'In your voice, no sales pitch', body: <>Scripts are written in first person, in your brand voice. They skip the lines viewers tune out: no &ldquo;hey guys&rdquo;, no asking for likes or subscribes, no price read aloud, and no on-camera push to a link.</> },
        { icon: <Clock size={18} />, title: 'Recent scripts', body: <>Every script is saved under <strong>Recent scripts</strong>, and reopening one shows it exactly as written, with no new generation and no cost. <strong>Scripts this month</strong> shows how many you have left before the monthly reset.</> },
      ]}
    />
  )
}

// ── Newsletter ───────────────────────────────────────────────────────────────
export function NewsletterGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="newsletter"
      icon={<Mail size={20} />}
      title="Your guide to the Newsletter"
      subtitle="Collect emails on your blog and send issues that link back to your posts."
      sections={[
        { icon: <Mail size={18} />, title: 'Turn on the signup form', body: <>The <strong>Newsletter status</strong> switch shows or hides the signup form on your blog; when it is on, the form appears on your homepage and in every blog post sidebar. Choose where it sits under <strong>Where the form shows up</strong>, and edit its wording under <strong>Signup form copy</strong>.</> },
        { icon: <FileText size={18} />, title: 'Put it anywhere else', body: <>Copy the shortcode from <strong>Embed the signup form</strong> and paste it into any WordPress page or post; the MVP plugin draws the form. It only saves signups while the status switch is on.</> },
        { icon: <ShieldCheck size={18} />, title: 'Brand and compliance', body: <>Set a <strong>Sender display name</strong> for the From line and a <strong>Mailing address</strong>, which US law requires in every commercial email (a PO box works).</> },
        { icon: <Globe size={18} />, title: 'Send from your own domain', body: <>Under <strong>Sender domain</strong>, enter a subdomain like mail.yourdomain.com, add the DNS records shown, then hit <strong>Verify</strong>. Until it is verified, MVP sends from a shared address, and your emails still arrive.</> },
        { icon: <Users size={18} />, title: 'Your subscribers', body: <>New signups show as pending until they confirm. <strong>Paste subscribers</strong> brings in a list from Mailchimp, Substack, ConvertKit or anywhere else as active, skipping anything over your plan’s limit and telling you how many; <strong>Export CSV</strong> downloads the list.</> },
        { icon: <PenLine size={18} />, title: 'Compose an issue', body: <>Pick blog posts, add a personal message and up to six curated links, then hit <strong>Draft email</strong>; MVP writes the subject, intro, a line for each post and the sign-off in your voice. Edit anything, check the live preview, and send to your active subscribers.</> },
        { icon: <Clock size={18} />, title: 'Schedule, test and target', body: <>On Pro you can <strong>Schedule for later</strong>, <strong>A/B test the subject line</strong> (the winning subject goes to the rest of the list after the test window), and <strong>Send to a segment only</strong>. <strong>Recent broadcasts</strong> shows delivered and bounced counts for every send.</> },
      ]}
    />
  )
}

// ── Link in Bio ──────────────────────────────────────────────────────────────
export function LinkInBioGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="link-in-bio"
      icon={<Link2 size={20} />}
      title="Your guide to Link in Bio"
      subtitle="A shoppable page of your products at one link for every bio."
      sections={[
        { icon: <Link2 size={18} />, title: 'Claim your link', body: <>Pick a handle and hit <strong>Create page</strong>; your page lives at /shop/your-handle. It stays a draft until you hit <strong>Publish</strong>, and <strong>Copy</strong> grabs the link for your bios.</> },
        { icon: <Palette size={18} />, title: 'Make it look like you', body: <>Set a display name and a one line bio, use <strong>Use my logo</strong> or <strong>Use headshot</strong> for the picture, and pick a theme and accent color. Add a <strong>Main button</strong> under your name, or leave it blank to hide it.</> },
        { icon: <ShoppingBag size={18} />, title: 'Fill it with products', body: <><strong>Import my posted products</strong> adds deals you posted, your published reviews, and Shorts you posted from Clip Factory. Turn on <strong>Auto-add products from my posts</strong> and products from Clip Factory Shorts you post to TikTok or Instagram land here automatically.</> },
        { icon: <Tag size={18} />, title: 'Add any product by hand', body: <>Paste any Amazon or product link and MVP turns it into your affiliate link using your chosen link style. Reorder, hide or delete any tile.</> },
        { icon: <Zap size={18} />, title: 'Current deals up top', body: <>Tick the products that are in your Stories and they move into the current deals shelf at the top; everything else stays under <strong>More sales I found</strong>. <strong>Clear all</strong> resets the shelf when your Stories expire.</> },
        { icon: <Instagram size={18} />, title: 'Post IG Stories from here', body: <><strong>Create IG Stories</strong> posts the deals you ticked as Instagram Stories, each with a link in bio call to action pointing back to this page.</> },
        { icon: <Megaphone size={18} />, title: 'Brand links and sponsor tabs', body: <>Tap a platform under <strong>Brand links</strong> to add your profile link. <strong>Advertisements</strong> adds sponsor tabs between your product sections, with an optional badge and promo code.</> },
        { icon: <MousePointerClick size={18} />, title: 'See what gets tapped', body: <>Each tile shows its click count, so you can see which picks your audience actually taps.</> },
      ]}
    />
  )
}

// ── MVP x Levanta ────────────────────────────────────────────────────────────
export function LevantaGuide() {
  return (
    <ToolGuide
      guideKey="levanta"
      version={2}
      accent="#A3E635"
      icon={<ShoppingBag size={20} />}
      title="Your guide to MVP x Levanta"
      subtitle="Scan your Levanta brands and turn the best products into posts."
      sections={[
        { icon: <KeyRound size={18} />, title: 'Connect your key', body: <>Paste your Levanta Creator API key in the <strong>Connect Levanta</strong> panel at the top; it is stored encrypted. Levanta approves API access, so request it from Levanta if you do not see it.</> },
        { icon: <Handshake size={18} />, title: 'Partner with brands in Levanta', body: <>Joining brands happens in Levanta, not here. Use <strong>Partner with brands in Levanta</strong>, then hit <strong>Refresh</strong>; brands you are approved for show a green <strong>Partnered</strong> badge.</> },
        { icon: <Sparkles size={18} />, title: 'Smart Scan', body: <>The <strong>MVP Finder</strong> sweeps every partnered brand and keeps only products that clear MVP&rsquo;s checks on commission, price, demand, rating and Levanta&rsquo;s earnings per click, ranked best first. Choose <strong>MVP Focus</strong> or the looser <strong>Wide</strong>, pick 10, 20 or 50 results, and add an optional focus keyword.</> },
        { icon: <Search size={18} />, title: 'Scan again for more', body: <>Run the same scan again and it skips what you have already seen, so you get the next best batch. Products you have already turned into a post are skipped too. Each result shows commission, price, estimated earnings per click and per sale, and rating.</> },
        { icon: <PenLine size={18} />, title: 'Generate a post', body: <><strong>Generate post</strong> opens <strong>Post options</strong>: format (review, buying guide or listicle), length, an AI scene or the real product photo as the hero, socials to post to, and draft or live. MVP creates a Levanta tracking link for that product, pulls the Amazon listing for specs and images, and writes the post in your voice. Socials only post when the post goes live.</> },
        { icon: <Link2 size={18} />, title: 'Your link, your style', body: <>The Levanta link follows the link style you chose in <strong>Brand Profile</strong>: Geniuslink or Bitly wraps it, and any other choice keeps the plain Levanta link. Drafts open in the WordPress editor from <strong>Review draft</strong>; live posts show <strong>View post</strong>.</> },
        { icon: <Bookmark size={18} />, title: 'Save, message, or buy', body: <><strong>Save</strong> puts a pick on your <strong>Saved for later</strong> shelf so you can generate it later. <strong>Message brand</strong> first checks for an Amazon Affiliate+ campaign; if there is none, MVP drafts a message for you to copy and opens the brand&rsquo;s Levanta page. <strong>Buy to review</strong> opens the Amazon listing.</> },
        { icon: <Store size={18} />, title: 'Or browse one brand', body: <>Below the finder, switch between <strong>Partnered</strong> and <strong>All</strong>, open any brand to see its products with commission, price and rating, and generate a post from there.</> },
      ]}
      footerNote={<><strong className="text-foreground">No guaranteed returns.</strong> The finder is a focused search of your own Levanta brands; what you earn depends on the product, your content and your audience.</>}
    />
  )
}

// ── MVP x PartnerBoost ───────────────────────────────────────────────────────
export function PartnerBoostGuide() {
  return (
    <ToolGuide
      guideKey="partnerboost"
      version={2}
      accent="#A3E635"
      icon={<Store size={20} />}
      title="Your guide to MVP x PartnerBoost"
      subtitle="Your Walmart, Amazon and DTC brands, turned into posts."
      sections={[
        { icon: <KeyRound size={18} />, title: 'Connect your token', body: <>In PartnerBoost go to <strong>Tools</strong>, then <strong>API</strong>, copy your All-Channels API token, and paste it in the <strong>Connect PartnerBoost</strong> panel at the top. It is stored encrypted.</> },
        { icon: <Handshake size={18} />, title: 'Join brands in PartnerBoost', body: <>MVP cannot join programs for you. Accept a brand&rsquo;s terms in PartnerBoost (some need the merchant&rsquo;s approval), then come back and hit <strong>Refresh</strong>; joined brands show a green <strong>Joined</strong> badge.</> },
        { icon: <Sparkles size={18} />, title: 'Smart Scan your joined brands', body: <>The <strong>MVP Finder</strong> sweeps every brand you have joined across Walmart, Amazon and DTC, keeps products that pass MVP&rsquo;s commission, price and category checks, and ranks them by estimated earnings per sale. Choose <strong>MVP Focus</strong> or <strong>Wide</strong> and add an optional focus keyword; scanning again shows the next batch.</> },
        { icon: <RefreshCw size={18} />, title: 'Sync once for instant scans', body: <>Hit <strong>Sync catalog</strong> to store your joined brands&rsquo; products; after that, scans are instant. Until you sync, each scan runs live and is slower.</> },
        { icon: <ShoppingCart size={18} />, title: 'Walmart Offers', body: <><strong>Walmart Offers</strong> runs the whole Walmart catalogue on PartnerBoost through MVP&rsquo;s rules, not just brands you have joined, and ranks it by estimated earnings per sale. Each card can <strong>Make blog post</strong>, <strong>Quick post to socials</strong>, or copy its tracking link. Tick <strong>Add to roundup</strong> on two or more, then <strong>Create roundup post</strong>.</> },
        { icon: <PenLine size={18} />, title: 'Generate a post', body: <><strong>Generate post</strong> writes a fact-grounded review in your voice with the real product image and saves it to WordPress as a draft or live, per the <strong>Saving as draft</strong> toggle. The affiliate link follows your Brand Profile link style, wrapped by Geniuslink or Bitly when you use one. Publishing needs a paid plan.</> },
        { icon: <Bookmark size={18} />, title: 'Save and message brands', body: <><strong>Save</strong> keeps a pick on your <strong>Saved for later</strong> shelf so you can generate it later. <strong>Message brand</strong> sends through Amazon when the product has an Affiliate+ campaign; otherwise MVP drafts a pitch for you to copy and opens the brand&rsquo;s PartnerBoost page.</> },
        { icon: <Store size={18} />, title: 'Or browse by network', body: <>Below, pick <strong>Walmart</strong>, <strong>Amazon</strong> or <strong>DTC</strong> and filter by <strong>Joined</strong>, <strong>Pending</strong> or <strong>No Relationship</strong>. Joined brands open a <strong>Products</strong> list you can generate from, and <strong>Link</strong> copies the brand&rsquo;s deep-link tracking base.</> },
      ]}
      footerNote={<><strong className="text-foreground">No guaranteed returns.</strong> Commissions and inventory come straight from PartnerBoost, so compare a brand&rsquo;s rate against your Amazon tag before you lean on it.</>}
    />
  )
}

// ── Brand Profile ────────────────────────────────────────────────────────────
export function BrandProfileGuide() {
  return (
    <ToolGuide
      guideKey="brand"
      version={2}
      accent="#60A5FA"
      icon={<Palette size={20} />}
      title="Your guide to Brand Profile"
      subtitle="Set this once; it flows into your whole site and every post."
      sections={[
        { icon: <Palette size={18} />, title: 'Your brand identity', body: <>Fill in <strong>Brand Identity</strong> (site name, tagline, author name) and pick your <strong>Affiliate Niches</strong> and <strong>Brand Tone</strong> so the writers cover the right topics in your tone. Your <strong>Blog URL</strong> is also the link MVP puts in your YouTube descriptions, so it can point to a portfolio or link hub instead.</> },
        { icon: <Link2 size={18} />, title: 'Pick one link style', body: <>Under <strong>Link style & connections</strong>, choose how MVP builds every link on your blog, YouTube descriptions and social posts: <strong>Passport Links</strong> (free geo-routing on paid plans), <strong>Genius Links</strong>, <strong>Bitly</strong>, or <strong>Direct</strong> tagged Amazon links. A change applies to content generated afterward.</> },
        { icon: <Tag size={18} />, title: 'Your Associates tag', body: <>Add your <strong>Amazon Associates tag</strong> and every link MVP builds earns on your account, whatever style you picked. The tag belongs to your active site, so if you run more than one brand, switch sites in the top bar first.</> },
        { icon: <Store size={18} />, title: 'Where your links send people', body: <>Choose <strong>Amazon</strong> or <strong>My TikTok Shop</strong> as the starting point for new posts. Every place you make a post can still switch it, so you never have to come back here.</> },
        { icon: <Search size={18} />, title: 'Google Search Console', body: <>Connect <strong>Google Search Console</strong> (read only) so MVP can show whether each post is indexed, its clicks, impressions and ranking, and the searches that find it. MVP never writes to it.</> },
        { icon: <Handshake size={18} />, title: 'How brands reach you', body: <>In <strong>Brand Outreach Contact</strong>, choose whether your YouTube descriptions send brands to your site or your email first. Your <strong>URL for brand collaborations</strong>, <strong>Media kit URL</strong>, storefront and sample shipping address fill in your Collaborations pitch emails; the shipping address is never shown on your blog.</> },
        { icon: <FileText size={18} />, title: 'How every post is built', body: <>In <strong>Content Preferences</strong>, set post length, images per article (up to 2), CTA style, and the affiliate disclaimer added to the top of every published post. Untick any <strong>Post sections</strong> (Quick Verdict, Pros and Cons, Scorecard, FAQ) you want left out.</> },
        { icon: <ShieldCheck size={18} />, title: 'Your look, synced to WordPress', body: <>Your logo, header banner, <strong>About You</strong> bio and photo, <strong>Brand Colors</strong>, <strong>Typography</strong> and <strong>Social Links</strong> style your blog. <strong>Save changes</strong> pushes them to your WordPress site and clears its cache; if that push fails, a <strong>Saved here, but the WordPress push failed</strong> notice says so. Image uploads save and sync on their own.</> },
      ]}
      footerNote={<><strong className="text-foreground">Clearing a field removes it everywhere.</strong> Empty a social link and save, and its icon comes off your live blog too.</>}
    />
  )
}

// ── Voice Training ───────────────────────────────────────────────────────────
export function VoiceTrainingGuide() {
  return (
    <ToolGuide
      guideKey="voice"
      version={2}
      icon={<Mic size={20} />}
      title="Your guide to Voice Training"
      subtitle="Teach MVP to write like you, so nothing sounds like a template."
      sections={[
        { icon: <Mic size={18} />, title: 'Why train your voice', body: <>Everything on this page is read by MVP each time it writes for you, so posts, scripts and captions sound like you rather than a template. The more specific your answers, the closer the match.</> },
        { icon: <Youtube size={18} />, title: 'Learn it from your videos', body: <>Press <strong>Scan my recent videos</strong> and MVP reads your YouTube transcripts to build a profile of how you actually sound. It shows as <strong>What MVP has learned about your voice</strong> with the number of videos it learned from, keeps getting sharper as you publish, and <strong>Rescan my videos</strong> updates it on demand.</> },
        { icon: <Layers size={18} />, title: 'A voice per channel', body: <>If you have more than one YouTube channel connected, <strong>Voice per channel</strong> shows a separate learned voice for each. Content made from a channel’s videos uses that channel’s voice.</> },
        { icon: <FileText size={18} />, title: 'The four basics', body: <>Fill in <strong>About You</strong>, <strong>Target Reader</strong>, and <strong>Your Writing Style</strong>, where you paste writing that sounds exactly like you. List anything you never want to read in <strong>Words & Phrases to Avoid</strong>, one per line, and it is kept out of every generated post.</> },
        { icon: <Sparkles size={18} />, title: 'Calibrate your style', body: <>Answer the <strong>Voice calibration</strong> questions (what sounds fake, weak, cringe or trustworthy to you) and pick a side on each line of <strong>Your communicative style</strong>. Then tick the speech patterns and thought process the writing should use; tap a selected option again to clear it.</> },
        { icon: <Lightbulb size={18} />, title: 'Let MVP fill the gaps', body: <>Once you have published a few posts, <strong>Refresh MVP suggestions</strong> reads them and fills in only the fields you left empty. Your own answers are never overwritten.</> },
        { icon: <PenLine size={18} />, title: 'Where it shows up', body: <>Your voice is used by the Blog Post Generator, Comparisons, Articles, Scriptwriter, Newsletter, Shorts Studio, and the captions MVP writes for your social posts.</> },
      ]}
      footerNote={<><strong className="text-foreground">Press Save in the bar at the bottom.</strong> Your changes apply to the next thing MVP writes for you.</>}
    />
  )
}

// ── Face Models (Photobooth) ─────────────────────────────────────────────────
export function FaceModelsGuide() {
  return (
    <ToolGuide
      guideKey="face-models"
      version={2}
      icon={<UserSquare size={20} />}
      title="Your guide to Face Models"
      subtitle="Add your likeness once, then put the real you on thumbnails, posts and headshots."
      sections={[
        { icon: <UserSquare size={18} />, title: 'What a face is', body: <>Each face is a set of your photos that MVP uses as the reference whenever it puts you in an image. It is ready the moment you save, with no training wait.</> },
        { icon: <Camera size={18} />, title: 'Add a face', body: <>Click <strong>Add a face</strong>, give it a name, and upload 4 to 20 photos (JPG, PNG or WebP, up to 10 MB each). Use clear, well lit, front facing shots of just you, mix angles and expressions, and aim for 10 or more for a stronger likeness.</> },
        { icon: <Users size={18} />, title: 'How many faces you can keep', body: <>Faces are included on paid plans, and your plan sets how many you can keep, shown next to <strong>Your faces</strong>. You can add more photos to an existing face at any time, up to 20.</> },
        { icon: <Shirt size={18} />, title: 'Pin an outfit', body: <>Set <strong>Outfit in thumbnails</strong> on a face (for example, a white lab coat) and every thumbnail puts you in it. Leave it blank to let MVP vary your outfit.</> },
        { icon: <Youtube size={18} />, title: 'Where your face is used', body: <>Pick a face in YouTube Co-Pilot under <strong>Who’s in this video?</strong>, in the <strong>Thumbnail Generator</strong>, in Liftoff, and in Instagram and Pinterest image posts. Co-Pilot and the Thumbnail Generator also offer a product-only option.</> },
        { icon: <Rocket size={18} />, title: 'A face per video in Liftoff', body: <>Liftoff sets one face for the whole batch. With two or more faces saved, each upload also asks <strong>Who’s in this video?</strong> so every video gets the right presenter, and any you leave unanswered use the batch’s face.</> },
        { icon: <ImageIcon size={18} />, title: 'Photobooth headshots', body: <>Pick a face, a look (Studio, Office, LinkedIn, Magazine, Cinematic or Outdoor), an expression and a shape, then generate a studio quality headshot for your profiles. Each one takes 1 to 3 minutes, and the page shows how many you have left this month.</> },
        { icon: <Trash2 size={18} />, title: 'Deleting a face', body: <>Deleting a face never changes thumbnails or posts that are already made. It removes the uploaded photos, so that face cannot be used on anything new until you add it again.</> },
      ]}
    />
  )
}

// ── Social Launch Kit ────────────────────────────────────────────────────────
export function SocialLaunchKitGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="social-launch-kit"
      icon={<Rocket size={20} />}
      title="Your guide to the Social Launch Kit"
      subtitle="Everything a new social profile needs, written and designed for you."
      sections={[
        { icon: <Rocket size={18} />, title: 'Six platforms, one kit each', body: <>Pick a card for <strong>Facebook Page</strong>, <strong>Pinterest</strong>, <strong>X (Twitter)</strong>, <strong>Threads</strong>, <strong>Bluesky</strong> or <strong>LinkedIn</strong> and hit <strong>Generate kit</strong>. MVP writes everything from your Brand Profile and voice, so set that up first (at least your name and niche).</> },
        { icon: <Type size={18} />, title: 'Every field, ready to paste', body: <>Each kit gives you name ideas, username ideas, a short bio, a longer About text sized to that platform’s limits, the best category, keywords and a first post. Pinterest also gets a set of starter boards with descriptions. Tap any item to copy it.</> },
        { icon: <ImageIcon size={18} />, title: 'Banner and profile picture', body: <>Generate a cover image and a profile picture at the exact size each platform uses, built from the logo and banner in your Brand Profile. Choose <strong>Bold</strong> or <strong>Minimal</strong> for the cover, or upload a <strong>Reference</strong> image to guide the look, then <strong>Download</strong>.</> },
        { icon: <Bookmark size={18} />, title: 'One generation per platform', body: <>Each kit and each image is generated once per platform, then saved on this page for you to come back to anytime; the button changes to <strong>Generated</strong> or <strong>Saved</strong>. Get your Brand Profile the way you want it before you generate.</> },
        { icon: <ListChecks size={18} />, title: 'Step by step setup', body: <>Open <strong>How to set up your</strong> on any card for numbered steps and a button that takes you to the platform. MVP cannot create the account for you, so you click the final create button yourself; every field and image is already done.</> },
        { icon: <Send size={18} />, title: 'Then connect and post', body: <>Once the profile is live, connect it in <strong>Connect Socials</strong>. From there you can publish to it with <strong>Social Push</strong> and with quick post in Deal Radar.</> },
      ]}
    />
  )
}

// ── SEO & Indexing ───────────────────────────────────────────────────────────
export function SeoGuide() {
  return (
    <ToolGuide
      guideKey="seo"
      version={2}
      accent="#C084FC"
      icon={<TrendingUp size={20} />}
      title="Your guide to SEO & Indexing"
      subtitle="See what Google does with your posts, and get them found faster."
      sections={[
        { icon: <BarChart3 size={18} />, title: 'Start at the top', body: <><strong>How your blog is doing</strong> shows whether your posts are being shown and clicked. <strong>Start here</strong> lists what to do next, biggest win first, and everything further down is the detail behind it.</> },
        { icon: <Zap size={18} />, title: 'Get my blog found', body: <>One click refreshes your sitemap, pings search engines and AI crawlers, heals changed links so nothing 404s, and auto-fixes SEO issues on every post. Run it any time; Google and Bing re-crawl over the following days.</> },
        { icon: <Signpost size={18} />, title: 'Win back rankings from broken links', body: <>In Search Console, open the <strong>Not found (404)</strong> report, press <strong>Export</strong> and drop the file here. MVP matches each dead URL to the right live post and redirects it (a 301), so the old ranking history carries over.</> },
        { icon: <Gauge size={18} />, title: 'Connect Search Console', body: <>Once Search Console is connected, you see which posts are indexed, their clicks and impressions over 28 days, why the rest are not indexed, and any post that dropped out of Google in the last week. Statuses refresh overnight, and <strong>Check</strong> re-checks one post straight away.</> },
        { icon: <Send size={18} />, title: 'Nudge Google with Index', body: <>On Pro, the <strong>Index</strong> button on an unindexed post sends Google a direct request through its Indexing API, up to 2 a day. It speeds things up but guarantees nothing. Bing, Yandex and Copilot are already told about every new post through IndexNow.</> },
        { icon: <Wand2 size={18} />, title: 'Fix every post', body: <>Each post gets an SEO score, worst first. Open a row to see what is missing, then press <strong>Fix</strong> on an issue or fix them all at once. <strong>Rebuild</strong> rewrites a post from its YouTube transcript at the same URL, and <strong>Tools</strong> holds Fix all posts, Refresh prices and Refresh post URLs.</> },
        { icon: <Bot size={18} />, title: 'Ready for AI answers', body: <><strong>AI search visibility</strong> checks that AI crawlers are allowed to read your site. <strong>AI-answer readiness</strong> scores how likely ChatGPT, Perplexity and Google AI Overviews are to quote each post, and shows which to fix first.</> },
        { icon: <Lightbulb size={18} />, title: 'Find what to write next', body: <><strong>Search demand you&rsquo;re missing</strong> lists searches you already appear for but no post targets, one click from a Buying Guide. <strong>Posts that are not earning their place</strong> is a read-only list of weak posts worth merging or improving; it never changes anything on its own.</> },
      ]}
      footerNote={<>More tools live in the tabs at the top: <strong className="text-foreground">Title Check, Clean Links, Duplicates, Fix 404s, Fix Formatting and Logo Check</strong>.</>}
    />
  )
}

// ── Ads ──────────────────────────────────────────────────────────────────────
export function AdsGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="ads"
      icon={<Megaphone size={20} />}
      title="Your guide to Ads"
      subtitle="Google AdSense plus your own affiliate banners, in one place."
      sections={[
        { icon: <Megaphone size={18} />, title: 'A second income stream', body: <>Affiliate links pay when someone buys; display ads pay for the visit itself. This page sets up both, and your changes go to your site when you hit <strong>Save</strong>.</> },
        { icon: <ShieldCheck size={18} />, title: 'Google AdSense in one field', body: <>Paste your <strong>AdSense Publisher ID</strong> (it starts with ca-pub), or your whole AdSense code snippet and MVP pulls the ID out. MVP then adds Google’s verification tag and Auto ads code to every page and serves your ads.txt, on the MVP theme or the MVP plugin.</> },
        { icon: <Clock size={18} />, title: 'Finish in AdSense', body: <>Back in AdSense, complete the site review, which can take anywhere from a few hours to a couple of weeks. Once approved, go to <strong>Ads</strong>, then <strong>By site</strong>, switch on <strong>Auto ads</strong>, and Google places ads across your blog.</> },
        { icon: <Layers size={18} />, title: 'Sidebar Banners', body: <>Add affiliate banners to the sidebar of every blog post: upload an image with its affiliate link, or paste HTML from Impact, ShareASale, CJ and similar. With more than one, <strong>Rotate order (random)</strong> shuffles them and <strong>Show at a time</strong> limits how many appear.</> },
        { icon: <ImageIcon size={18} />, title: 'Homepage Banner Strip', body: <>Three banner slots in a row on your homepage, each a 16:9 image with an optional destination URL. Empty slots show an “Advertise here” placeholder; switch the strip off with <strong>Show this strip on the homepage</strong>.</> },
        { icon: <FileText size={18} />, title: 'In-Content Banners', body: <>Place a banner inside every blog post, as an image or HTML embed, and choose which paragraph it appears after.</> },
        { icon: <Wrench size={18} />, title: 'Using your own theme?', body: <>Banners need the MVP theme’s layout, so the three banner sections are hidden on sites that use their own theme. AdSense still works there through the MVP plugin.</> },
      ]}
      footerNote={<>Keep ads from burying your product links: a clean, fast page converts affiliate clicks better.</>}
    />
  )
}

// ── Brainstorm ───────────────────────────────────────────────────────────────
export function BrainstormGuide() {
  return (
    <ToolGuide
      guideKey="brainstorm"
      icon={<Lightbulb size={20} />}
      title="Your guide to Brainstorm"
      subtitle="See what is actually working, then decide what to make next."
      sections={[
        { icon: <BarChart3 size={18} />, title: 'Grounded in your data', body: <>This reads your last 90 days: which posts and products earned clicks, which topics pulled traffic. It is not random ideas; it is what your own audience responds to.</> },
        { icon: <Lightbulb size={18} />, title: 'What to make next', body: <>It turns those patterns into concrete next posts: more of a winning angle, a comparison your readers are clearly shopping for, a roundup around a product that is converting.</> },
        { icon: <PenLine size={18} />, title: 'Act on it', body: <>Take an idea straight into the Blog Post Generator, Comparisons, or Buying Guides and publish it.</> },
      ]}
    />
  )
}

// ── Analytics ────────────────────────────────────────────────────────────────
export function AnalyticsGuide() {
  return (
    <ToolGuide
      guideKey="analytics"
      accent="#0a84ff"
      icon={<BarChart3 size={20} />}
      title="Your guide to Analytics"
      subtitle="Real affiliate-link clicks on your posts, last 30 days."
      sections={[
        { icon: <MousePointerClick size={18} />, title: 'Clicks that count', body: <>This shows human clicks on the affiliate links inside your MVP-generated posts over the last 30 days; bots are filtered out, so the numbers reflect real shopping intent.</> },
        { icon: <TrendingUp size={18} />, title: 'Find your winners', body: <>Spot which posts and products actually get clicked, then double down: make more content around what earns and refresh what does not.</> },
        { icon: <FileText size={18} />, title: 'Clicks, then sales', body: <>Clicks are the leading signal; your Amazon and network dashboards show the sales those clicks turn into. Use both together.</> },
      ]}
    />
  )
}

// ── MVP Help Desk (Assistant) ────────────────────────────────────────────────
export function AssistantGuide() {
  return (
    <ToolGuide
      guideKey="assistant"
      version={2}
      icon={<MessageCircle size={20} />}
      title="Your guide to the MVP Help Desk"
      subtitle="Ask how to do anything in MVP, or get affiliate strategy advice."
      sections={[
        { icon: <MessageCircle size={18} />, title: 'Two jobs in one', body: <>Ask how any part of MVP works (where a feature lives, how to connect a site), or ask for strategy (what to review next, how to land a brand deal). It answers from MVP’s own feature guide, so its steps match the product.</> },
        { icon: <Sparkles size={18} />, title: 'Advice based on your account', body: <>It reads your brand name, niches and tone, the reviews you have published recently, and your recent Creator Connections campaigns. A question like “what should I review next” is answered from your real catalogue.</> },
        { icon: <Lightbulb size={18} />, title: 'Not sure what to ask?', body: <>A new chat offers starter questions, such as how to get your first review published. Tap one to send it.</> },
        { icon: <Brain size={18} />, title: 'Memory across chats', body: <>Open <strong>Memory</strong> to see what MVP remembers about you across all your chats; it updates itself as you talk. <strong>Clear all memory</strong> wipes it.</> },
        { icon: <Upload size={18} />, title: 'Bring what another AI knows', body: <>Under <strong>Import knowledge</strong>, paste notes or use <strong>Upload file</strong> for a text, markdown, JSON or CSV export from another AI tool, then press <strong>Import to memory</strong>. MVP keeps the lasting facts and does not store the raw text.</> },
        { icon: <Inbox size={18} />, title: 'Your saved chats', body: <>Every conversation is saved in your chat list, so you can reopen one or start a <strong>New chat</strong>. Deleting a conversation removes its messages for good.</> },
        { icon: <Clock size={18} />, title: 'Your monthly messages', body: <>Your plan includes a set number of Help Desk messages each billing period. When you reach it, the chat says so and tells you when it resets.</> },
      ]}
    />
  )
}

// ── Brand Deals (Collaborations) ─────────────────────────────────────────────
export function CollaborationsGuide() {
  return (
    <ToolGuide
      guideKey="collaborations"
      version={2}
      accent="#60A5FA"
      icon={<Handshake size={20} />}
      title="Your guide to Brand Deals"
      subtitle="MVP researches the brand and writes a pitch email that sells your work."
      sections={[
        { icon: <Handshake size={18} />, title: 'Start with the brand', body: <>Enter the <strong>Brand name</strong> (the only required field), plus the brand&rsquo;s website and the product name or ASIN if you have them. Give an ASIN and MVP looks the product up so the email can name it and point out a feature or two.</> },
        { icon: <Search size={18} />, title: 'Research built in', body: <>When you hit <strong>Generate pitch email</strong>, MVP searches the web for the brand first, then writes the email around what it finds. It can take up to a minute.</> },
        { icon: <Link2 size={18} />, title: 'Your channels and media kit', body: <>Add your Amazon storefront, blog, YouTube, link hub and <strong>Media kit URL</strong>, plus WhatsApp, WeChat or Lark if brands can reach you there. Many of these pre-fill from your profile, so you only type them once.</> },
        { icon: <Tag size={18} />, title: 'Set your offer', body: <>Pick the platforms you are offering; the email only names the ones you select. Then answer the Yes/No questions: free sample, banner ad, production fee, copyright fee for full usage rights, live streams, and whether to include your shipping address from Brand Profile. Paid options are pitched as optional extras, not demands.</> },
        { icon: <Bookmark size={18} />, title: 'Show your track record', body: <>Add how many collaborations you have done, up to three links to your best work, and any wins or badges. <strong>Save track record</strong> keeps them so they pre-fill next time.</> },
        { icon: <Mail size={18} />, title: 'Edit, copy, send', body: <>The subject and body are both editable. Use <strong>Copy subject</strong> and <strong>Copy body</strong> to paste them into your own email; MVP does not send it for you.</> },
        { icon: <FileText size={18} />, title: 'Past pitches', body: <>Every pitch is kept under <strong>Past pitches</strong> with its platforms and date. Copy one again, or select several and delete them.</> },
        { icon: <Send size={18} />, title: 'Brand Outreach Profile', body: <>The <strong>Brand Outreach Profile</strong> at the top is saved once and fills every <strong>Message brand</strong> draft across MVP: greeting, credibility line, offer, links and sample shipping details. The credibility line goes out word for word, so keep it true.</> },
      ]}
      footerNote={<><strong className="text-foreground">Monthly limit:</strong> your plan sets how many pitch emails you can draft each month.</>}
    />
  )
}

// ── Shop Burner (Instagram Burner) ───────────────────────────────────────────
export function ShopBurnerGuide() {
  return (
    <ToolGuide
      guideKey="shop-burner"
      accent="#E1306C"
      icon={<Video size={20} />}
      title="Your guide to Shop Burner"
      subtitle="Turn a YouTube Short into a shoppable IG Reel or TikTok."
      sections={[
        { icon: <Video size={18} />, title: 'Reuse your Shorts', body: <>Take a YouTube Short you already made and turn it into an Instagram Reel or TikTok, so one video works across every platform.</> },
        { icon: <Tag size={18} />, title: 'Burn on a CTA', body: <>It adds a call-to-action onto the video and sets up an auto-DM link, so viewers who comment get sent straight to your product.</> },
        { icon: <Send size={18} />, title: 'Publish and grow', body: <>Post it to your connected accounts from here. More surfaces for the same content means more clicks on your links.</> },
      ]}
    />
  )
}

// ── Customize Blog ───────────────────────────────────────────────────────────
export function CustomizeGuide() {
  return (
    <ToolGuide
      guideKey="customize"
      version={2}
      accent="#60A5FA"
      icon={<Wrench size={20} />}
      title="Your guide to Customize Blog"
      subtitle="The blog settings Brand Profile does not cover."
      sections={[
        { icon: <ShieldCheck size={18} />, title: 'Connection only', body: <>Turn on <strong>Connection only (keep my blog design)</strong> to use MVP&rsquo;s posting and connection features without restyling your site. The homepage &ldquo;Recently Updated&rdquo; strip and the in-content review blocks go away, and your theme&rsquo;s own layout stays as it is. If the page says so, update the MVP Affiliate plugin first.</> },
        { icon: <Palette size={18} />, title: 'Brand Profile still leads', body: <>Your logo, header banner, bio, socials, brand name, tagline, fonts and colours live in <strong>Brand Profile</strong>. Sidebar and in-content ads have moved to the <strong>Ads</strong> page.</> },
        { icon: <UserSquare size={18} />, title: 'Reviewer Trust Block', body: <>This adds a reviewer box to every post with your name, a credibility tagline, a real photo and a &ldquo;More about me&rdquo; link. Name and photo come from Brand Profile unless you change them here.</> },
        { icon: <Star size={18} />, title: 'Your homepage lineup', body: <><strong>Featured posts (Editor&rsquo;s Picks)</strong> pins the big hero and the four cards in the Editor&rsquo;s Picks row; any slot left on Automatic shows your newest post. <strong>Pick of the Day</strong> features a post in the sidebar or on the homepage. It rotates every 12 or 24 hours, or you can pin one post.</> },
        { icon: <Layers size={18} />, title: 'How posts look', body: <>Site-wide switches cover post dates, a sticky header, comments, the bio on your About page, and price in product schema. The read counter adds a reads chip to each post and to the blog once they pass the thresholds you set.</> },
        { icon: <Mail size={18} />, title: 'Mid-article newsletter form', body: <>This drops a signup form into every post, after the paragraph you choose, with your own headline, subtitle and button label. Signups go to your existing MVP newsletter list.</> },
        { icon: <Link2 size={18} />, title: 'Footer links and tracking', body: <>Add <strong>Custom Links</strong> to the footer and paste verification tags from services like Google Search Console. Enter your GA4 Measurement ID or a Tag Manager ID and the theme adds the tracking tag for you.</> },
        { icon: <Send size={18} />, title: 'Save & Push to Blog', body: <>Changes go live when you press <strong>Save &amp; Push to Blog</strong>, which also clears your site cache; <strong>Clear Cache</strong> does that on its own. If WordPress refuses the push, the page tells you, and your settings stay saved in MVP.</> },
      ]}
    />
  )
}

// ── Deals Hub ────────────────────────────────────────────────────────────────
export function DealsHubGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="deals-hub"
      accent="#f43f5e"
      icon={<Zap size={20} />}
      title="Your guide to the Deals Hub"
      subtitle="Drop an Amazon link, get a timely deal post on your blog."
      sections={[
        { icon: <Zap size={18} />, title: 'One link in, a deal post out', body: <>Paste an Amazon URL, a Geniuslink, an amzn.to link or a bare ASIN, and MVP writes a deal post and publishes it to your WordPress blog. It works with Amazon products only; the link on the page takes you to Amazon Associates’ own Deals Hub to find deals you qualify for.</> },
        { icon: <Eye size={18} />, title: 'Full auto or Let me see', body: <><strong>Full auto</strong> writes and publishes in one go. <strong>Let me see</strong> shows the product and the deal MVP found first, so you can adjust the occasion, promo code, end date or schedule before <strong>Write the deal post & publish</strong>.</> },
        { icon: <ShieldCheck size={18} />, title: 'Amazon embargo, built in', body: <>Amazon allows a deal to be published only once it is live on amazon.com, and an event’s dates only once Amazon has announced them. If you pick an event whose dates are not announced yet, MVP writes the post now and schedules it for the moment they can be named. For a deal that starts later, set <strong>Schedule publish</strong> to its start time.</> },
        { icon: <Clock size={18} />, title: 'Schedule publish', body: <>Pick a time at least a few minutes ahead and the post is written now, then WordPress takes it live at exactly that time. Scheduled posts show a <strong>Publishes</strong> date in <strong>Recent deals</strong>.</> },
        { icon: <Tag size={18} />, title: 'Promo codes, links and occasions', body: <>A <strong>Promo code</strong> goes into the deal banner and the buy buttons; a <strong>Special promo URL</strong> replaces the buy button link. Leave <strong>Occasion</strong> on auto-detect or pick one; the thumbnail badge shows that occasion, or DEAL. With a deal end date (from Amazon or <strong>Deal end date</strong>), the banner counts down to it once the MVP plugin is installed.</> },
        { icon: <TrendingUp size={18} />, title: 'No discount? Still a post', body: <>If Amazon shows no discount on the product, MVP writes it up as a low-price alert instead of refusing, and the preview tells you so.</> },
        { icon: <Send size={18} />, title: 'Socials only', body: <>Tick <strong>Socials only, skip the blog post</strong> to post or schedule the deal straight to your connected social accounts. No blog post is written and none of your monthly generations are used.</> },
        { icon: <Wrench size={18} />, title: 'Keep live posts current', body: <>In <strong>Recent deals</strong>, <strong>$</strong> refreshes Amazon’s price (the article and images stay the same), <strong>↻</strong> regenerates the whole post, and the bin deletes it from your blog as well as from MVP.</> },
      ]}
      footerNote={<>Deals Hub is built for real sale events. Between Amazon events it can be paused, and the page says so when it is.</>}
    />
  )
}

// ── Shorts Studio ────────────────────────────────────────────────────────────
export function ShortsStudioGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="shorts-studio"
      icon={<Scissors size={20} />}
      title="Your guide to Shorts Studio"
      subtitle="One long video becomes a batch of captioned vertical Shorts."
      sections={[
        { icon: <Sparkles size={18} />, title: 'Find the best moments', body: <>Hit <strong>Find Shorts</strong> and MVP reads the video’s transcript and suggests its strongest 15 to 30 second moments, each with a hook, a caption and a score out of 100. If YouTube has no transcript, upload the video and MVP transcribes it.</> },
        { icon: <Download size={18} />, title: 'Get the source video', body: <>Rendering needs the full video. Use <strong>Fetch this video automatically</strong> when it is offered, or upload the MP4 once (under 300 MB) and every clip is cut from it.</> },
        { icon: <Layers size={18} />, title: 'Fine tune before you render', body: <>Use <strong>Edit</strong> on any suggestion to change its start and end time, its on-screen hook or its caption. Save, then render to apply the change.</> },
        { icon: <Type size={18} />, title: 'Captions and layout', body: <>Captions are burned in word for word from what you actually said, timed to your speech; switch them off for a clean clip, or pick a caption style. Choose <strong>Standard</strong> or <strong>Split screen</strong>, then hit <strong>Render Short</strong>.</> },
        { icon: <Send size={18} />, title: 'Post or download', body: <>A finished Short can be downloaded or posted to <strong>TikTok</strong>, <strong>Instagram</strong> or <strong>YouTube</strong> straight from the list. Each button shows when that clip has been posted.</> },
        { icon: <ShieldCheck size={18} />, title: 'Plan and limits', body: <>Shorts are a Pro feature, capped at <strong>{SHORTS_MONTHLY_CAP} finished Shorts a month</strong>; the counter shows how many you have left. Only use videos you own or have the rights to.</> },
      ]}
      footerNote={<>Want a shoppable call to action or a product link on the clip? Use <strong className="text-foreground">Clip Factory</strong>, which does the same cutting and adds an Enhance step before publishing.</>}
    />
  )
}

// ── Clip Factory ─────────────────────────────────────────────────────────────
export function ClipFactoryGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="clip-factory"
      icon={<Video size={20} />}
      title="Your guide to Clip Factory"
      subtitle="Create a vertical clip, add a shoppable call to action, then publish it."
      sections={[
        { icon: <Youtube size={18} />, title: 'Three ways to start', body: <>Choose <strong>Pick a regular YouTube video</strong>, <strong>Pick a YouTube Short</strong> you already posted, or <strong>Upload your own video</strong> (up to 300MB). Regular videos can be up to <strong>10 minutes</strong> long; you can also paste a YouTube link and tick the box confirming you own it or have the rights. A horizontal upload asks you to pick <strong>Center crop</strong> or <strong>Split screen</strong> first.</> },
        { icon: <Scissors size={18} />, title: 'MVP finds the best moments', body: <>On a regular video, hit <strong>Find Shorts</strong> (or <strong>Generate Clips</strong> for a pasted link) and MVP reads the transcript, suggests the strongest 15 to 30 second moments, and scores each out of 100. Use <strong>Edit</strong> to change a clip’s trim, hook or caption before you render.</> },
        { icon: <Type size={18} />, title: 'Captions from what you said', body: <>Each clip is cut vertical (9:16) with word for word captions pulled from your transcript; switch them off for a clean clip, or pick a caption style. Hit <strong>Render Short</strong>, then <strong>Use this clip</strong> to move on.</> },
        { icon: <Tag size={18} />, title: 'Add a call to action', body: <>In <strong>Enhance</strong>, choose a <strong>CTA box</strong> or <strong>Caption text</strong>, then set where the clip is going and how people buy: <strong>In-app shop</strong> or <strong>Link in bio</strong>. Pick a <strong>Recommended</strong> badge, one from <strong>Gallery</strong> or <strong>My boxes</strong>, or <strong>Make your own</strong> from a few words; drag it on the preview, resize it, and choose how long it shows.</> },
        { icon: <ShoppingBag size={18} />, title: 'Add the product', body: <>Paste an Amazon ASIN, store URL or TikTok Shop link, plus the product name if you like, and MVP writes a suggested caption for it. If <strong>Auto-add products from my posts</strong> is on in Link in Bio, the product lands on your Shop page when you post to TikTok or Instagram. Hit <strong>Burn overlay & continue</strong>, or use <strong>Skip</strong> to publish the clip as is.</> },
        { icon: <Send size={18} />, title: 'Publish from here', body: <>Post the finished clip to <strong>TikTok</strong>, <strong>Instagram</strong> or <strong>YouTube</strong>, or <strong>Download</strong> it. <strong>Choose Reel cover</strong> sets the still frame Instagram shows; YouTube asks for publishing access the first time and adds tags automatically. Each button turns solid and reads Posted once that post goes through.</> },
        { icon: <ShieldCheck size={18} />, title: 'Ground rules and limits', body: <>Only use your own videos or ones you have the rights to. Rendering is a Pro feature, capped at <strong>{SHORTS_MONTHLY_CAP} finished Shorts a month</strong>; the counter beside the title shows how many you have left and when it resets.</> },
      ]}
      footerNote={<><strong className="text-foreground">Longer videos are not better here.</strong> Clip Factory works best on tight, spoken review content: pick a video with a face and clear speech.</>}
    />
  )
}

// ── Instagram Auto-DM ────────────────────────────────────────────────────────
export function InstagramDmGuide() {
  return (
    <ToolGuide
      version={2}
      guideKey="instagram-dm"
      accent="#E1306C"
      icon={<Instagram size={20} />}
      title="Your guide to Instagram Auto-DM"
      subtitle="A keyword comment triggers an automatic DM with your link."
      sections={[
        { icon: <Clock size={18} />, title: 'Waiting on Meta approval', body: <>Instagram messaging needs Meta to approve MVP’s app, and that review is still in progress. You can set everything up now; no DMs are sent until approval lands, and then they start on their own.</> },
        { icon: <MessageCircle size={18} />, title: 'How it works', body: <>Turn on <strong>Enable comment → auto-DM</strong>. When someone comments your keyword on an Instagram or Facebook post that MVP published, MVP sends them a DM with that post’s own affiliate link.</> },
        { icon: <KeyRound size={18} />, title: 'Pick a trigger keyword', body: <>The <strong>Trigger keyword</strong> is matched as a whole word and is not case sensitive, so a comment of “link please!” triggers on LINK.</> },
        { icon: <Mail size={18} />, title: 'Write the DM', body: <>In <strong>DM message</strong>, put <strong>{'{link}'}</strong> where the post’s link should go and keep the opt-out line, which Meta requires. The <strong>Preview</strong> shows exactly what people will receive.</> },
        { icon: <Send size={18} />, title: 'Reply in public too', body: <>Leave <strong>Also reply publicly</strong> on so other viewers see the DM is on its way, then hit <strong>Save settings</strong>.</> },
        { icon: <Video size={18} />, title: 'A Reel with its own keyword', body: <>Once approval lands, the Instagram publish step in Clip Factory can give a single Reel its own trigger word and link. Those Reels are listed under <strong>Your Auto-DM Reels</strong>, where <strong>Off</strong> stops one.</> },
      ]}
    />
  )
}

// ── Brand Inquiries ──────────────────────────────────────────────────────────
export function BrandInquiriesGuide() {
  return (
    <ToolGuide
      guideKey="brand-inquiries"
      version={2}
      accent="#60A5FA"
      icon={<Inbox size={20} />}
      title="Your guide to Brand Inquiries"
      subtitle="Brand messages from your blog, plus the banner that brings them in."
      sections={[
        { icon: <Megaphone size={18} />, title: 'Turn on the banner', body: <>In the panel on the right, switch on <strong>Show the banner on my blog</strong> to add a small &ldquo;Work with us&rdquo; pill near the top of every blog page. Edit the <strong>Button on your blog</strong> text, the <strong>Pop-up headline</strong>, and <strong>Your pitch to brands</strong>.</> },
        { icon: <Link2 size={18} />, title: 'Choose where brands go', body: <>Add a <strong>Link URL</strong> (media kit, portfolio, booking form) with its own button label, and turn on <strong>Link straight to it</strong> if you want to skip the pop-up. Turn on <strong>In-app contact form</strong> to let brands message you without your email going public.</> },
        { icon: <ShieldCheck size={18} />, title: 'Save pushes it live', body: <><strong>Save banner settings</strong> updates your blog. If the push to WordPress fails, you get a warning instead of the success message, so check your WordPress connection. The banner needs either a link or the form turned on, otherwise it has nowhere to send brands.</> },
        { icon: <Inbox size={18} />, title: 'Messages land here', body: <>Form messages appear under <strong>Messages</strong> with the brand, contact, date and the blog page they wrote from. New ones have a purple edge, and <strong>Brand Inquiries</strong> in the menu shows an unread count until you open this page.</> },
        { icon: <Mail size={18} />, title: 'Reply or archive', body: <>When the brand left an email, <strong>Reply</strong> opens your email app already addressed to them. <strong>Archive</strong> clears a message from the list once you are done.</> },
        { icon: <Handshake size={18} />, title: 'Turn interest into deals', body: <>These are warm leads: brands that found you and want to work with you. Reply, agree on terms, and cover their product; use <strong>Brand Deals</strong> when you want MVP to help write the pitch.</> },
      ]}
    />
  )
}

// ── Virtual Assistants (Agency) ──────────────────────────────────────────────
export function VirtualAssistantsGuide() {
  return (
    <ToolGuide
      guideKey="virtual-assistants"
      version={2}
      icon={<Users size={20} />}
      title="Your guide to Virtual Assistants"
      subtitle="Give a VA their own login without sharing yours."
      sections={[
        { icon: <Users size={18} />, title: 'Delegate without sharing your password', body: <>Invite a VA or contractor and they get their own login on your single Pro subscription. Pro includes up to 3 VA seats, and the page shows how many are in use.</> },
        { icon: <Mail size={18} />, title: 'Send an invite', body: <>Enter their email, set their permissions, add an optional personal note, and press <strong>Send invite</strong>. Invites they have not accepted wait under <strong>Pending invites</strong>, where you can cancel one and invite the same email again later.</> },
        { icon: <Layers size={18} />, title: 'What a VA can see', body: <>VAs work inside your workspace: your videos, posts, WordPress sites, brand voice and face library. What they generate counts against your Pro plan’s usage and AI cost.</> },
        { icon: <ShieldCheck size={18} />, title: 'What stays yours', body: <>VAs cannot open billing, your WordPress and integrations setup, Customize Blog, API keys, or the Virtual Assistants page, and they cannot read your stored API keys.</> },
        { icon: <KeyRound size={18} />, title: 'What permissions do today', body: <><strong>Manage newsletter</strong> is enforced: a VA without it cannot send or edit your list. The other five are saved on each VA and shown on the page, but are not yet checked everywhere, so treat them as your intent rather than a lock.</> },
        { icon: <Trash2 size={18} />, title: 'Change or remove access', body: <>Edit a VA’s permissions from their row at any time. Revoke them and they lose access to your workspace immediately; their own account stays open but is no longer linked to yours.</> },
      ]}
      footerNote={<><strong className="text-foreground">Invite people you trust with your workspace.</strong> Most permissions are not locks yet, and revoking is the way to remove access.</>}
    />
  )
}

// ── Liftoff ────────────────────────────────────────
export function LiftoffGuide() {
  return (
    <ToolGuide
      guideKey="liftoff"
      version={1}
      accent="#0EA5A4"
      icon={<Rocket size={20} />}
      title="Your guide to Liftoff"
      subtitle="Up to ten videos, set up once, launched to YouTube and Amazon."
      sections={[
        { icon: <Upload size={18} />, title: 'Add up to 10 videos', body: <>In <strong>Add your videos</strong>, pick up to 10 files at once, each under 500MB. Every file gets its own bar showing MB sent, speed and time left, and one that stalls starts again by itself; keep the tab open until they finish. If a file name contains the product’s ASIN (like Ninja Crispi B0DDDD8WD6.mp4), the product is filled in for you.</> },
        { icon: <UserSquare size={18} />, title: 'Who’s in this video?', body: <>With two or more faces saved in Face Models, each upload asks <strong>Who’s in this video?</strong> beside its bar, so the right presenter goes on its thumbnail. Anything you leave unanswered uses the face chosen for the batch.</> },
        { icon: <MousePointerClick size={18} />, title: 'Choose the CTA and thumbnail look', body: <>Pick one CTA design, one of nine spots, a size, and when it shows (<strong>Early, for 10s</strong> or <strong>Last 8 seconds</strong>), or choose <strong>No CTA on these</strong>. For thumbnails, choose who is on them, one or more looks (<strong>Mix it up</strong> varies them) and the badge. Every video gets two: one with the hook for YouTube and the English stores, and one with no words for the other countries.</> },
        { icon: <Globe size={18} />, title: 'Pick your Amazon countries', body: <>Tick the storefronts for the batch. Each shows whether Amazon sells every video’s product there and how many more uploads it takes today (20 on the US store, 10 on the others); a country MVP cannot check ahead of time says so. Press <strong>Check I am signed in</strong> to make sure your Amazon Creator account is signed in for each.</> },
        { icon: <Tag size={18} />, title: 'Set each product', body: <>Paste the ASIN or Amazon link for each video. Each has its own <strong>Title for YouTube</strong> and <strong>Title for Amazon</strong>, both with <strong>Write it for me</strong>; leave the Amazon title empty and MVP writes one, and other countries get it translated. The arrows on each row set the order the videos go out in.</> },
        { icon: <Clock size={18} />, title: 'Schedule, check the channel, launch', body: <>Choose <strong>YouTube and Amazon</strong> or <strong>Amazon only</strong>, then give each video its own date and time, or let the daily pattern fill the rest; <strong>Notify subscribers</strong> stays off unless you turn it on. Above the <strong>Launch</strong> button, MVP asks YouTube which channel your login uploads to, and you confirm it with <strong>Yes, upload here</strong>.</> },
        { icon: <Youtube size={18} />, title: 'What happens on YouTube', body: <>On MVP’s servers, with the tab closed, each video gets its CTA burned in, both thumbnails built, and a description written with your affiliate link. It is uploaded private with paid promotion set through YouTube and read back, gets its thumbnail and your playlist, and goes public at its time. SCOUT then does the Studio steps you ticked (monetization, ad rating, product tag, end screen) while Chrome is open.</> },
        { icon: <Store size={18} />, title: 'What happens on Amazon', body: <>Amazon does not follow the YouTube schedule: once a video is launched, MVP checks the product is sold in each country, then translates the title and dubs the audio for the non-English stores. SCOUT uploads each listing through your own signed-in Amazon Creator account, checking every two minutes while the page is open. Turn on <strong>Keep going when this page is closed</strong> and SCOUT finishes in a pinned background tab whenever Chrome is open.</> },
      ]}
      footerNote={<><strong className="text-foreground">The report shows what happened, not what was planned.</strong> After launch, every video’s YouTube and Amazon country results come from what came back, and a stopped row says why, with <strong>Try again</strong> to put it back in the queue.</>}
    />
  )
}
