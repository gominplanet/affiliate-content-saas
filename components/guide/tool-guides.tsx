'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-tool guide content. Each export is a thin, self-contained wrapper around
// <ToolGuide> for one page. A page adds its guide by passing the component to
// PageHero's `guide` slot, e.g. `guide={<AmzFinderGuide />}`. All copy uses
// colons/semicolons, no em-dashes.

import ToolGuide from '@/components/guide/ToolGuide'
import {
  ShoppingBag, Sparkles, Search, Tag, ShoppingCart, PenLine, Bookmark, ShieldCheck,
  Youtube, Image as ImageIcon, Type, FileText, Layers, Send, Mail, Link2, Scale,
  BookOpen, Palette, Mic, UserSquare, Rocket, TrendingUp, Store, Megaphone, Video,
  Lightbulb, BarChart3, MessageCircle, Handshake, Wrench, MousePointerClick,
  Zap, Scissors, Users, Inbox, Clock, KeyRound, Instagram,
} from 'lucide-react'

// ── AMZ Product Finder ───────────────────────────────────────────────────────
export function AmzFinderGuide() {
  return (
    <ToolGuide
      guideKey="amz-finder"
      icon={<ShoppingBag size={20} />}
      title="Your guide to the AMZ Product Finder"
      subtitle="Two ways to research: the whole Amazon catalogue, or Affiliate+ campaigns."
      sections={[
        { icon: <ShoppingBag size={18} />, title: 'Pick your research area first', body: <>At the top you choose one of two modes. <strong>Amazon Product Research</strong> searches the entire Amazon catalogue for products to review. <strong>Affiliate+ (Creator Connections)</strong> searches campaigns that pay you an elevated bounty; it needs your own Creator Connections access.</> },
        { icon: <Search size={18} />, title: 'Amazon Product Research', body: <>Search the whole catalogue by keyword, then narrow with the filters: price, star rating, review count, best-seller rank, and category. Every result links out with <strong>your own Associates tag</strong>, so clicks earn on your account.</> },
        { icon: <ShoppingCart size={18} />, title: 'Buy to review vs your affiliate link', body: <>The green <strong>cart</strong> button is a plain Amazon link with no tag: it is for buying the product yourself to review (you cannot earn commission on your own purchase). The tagged link is only used on the content you publish.</> },
        { icon: <PenLine size={18} />, title: 'Write a review in one click', body: <><strong>Write review</strong> generates a full SEO article for that product and publishes it to your WordPress: headline, FAQ, disclosure, and your affiliate link all handled.</> },
        { icon: <Sparkles size={18} />, title: 'Affiliate+ : Browse vs Smart Scan', body: <><strong>Browse all</strong> is an instant, sortable view of every live Creator Connections campaign. <strong>Smart Scan</strong> runs SCOUT against your own grid to surface only the MVP-approved picks, ranked by the buy-to-review math.</> },
        { icon: <Bookmark size={18} />, title: 'Save winners for later', body: <>Hit <strong>Save</strong> on anything worth acting on; it lands in your <strong>Saved for later</strong> shelf below, your private buy-to-review shortlist. From there you can message the brand, buy to review, or write the review when you are ready.</> },
      ]}
      footerNote={<><strong className="text-foreground">Your links are always tagged for you.</strong> Set your Associates tag in Brand Profile once and every product link carries it automatically.</>}
    />
  )
}

// ── YouTube Co-Pilot ─────────────────────────────────────────────────────────
export function CoPilotGuide() {
  return (
    <ToolGuide
      guideKey="co-pilot"
      accent="#FF0000"
      icon={<Youtube size={20} />}
      title="Your guide to YouTube Co-Pilot"
      subtitle="Turn a video into a thumbnail, a title, metadata, and a blog post."
      sections={[
        { icon: <Youtube size={18} />, title: 'What Co-Pilot does', body: <>Point it at one of your YouTube videos and it turns that video into content: a click-worthy thumbnail, stronger titles, full description and tags, and a matching SEO blog post; all in your brand look.</> },
        { icon: <ImageIcon size={18} />, title: 'Thumbnails in your style', body: <>Generated thumbnails follow your saved <strong>Thumbnail style</strong>: neon border, accent colour, and face. Lock a specific likeness, use product-only, or turn faces off. You can also hide the green checkmark badge if you prefer a cleaner look.</> },
        { icon: <Type size={18} />, title: 'Titles & metadata', body: <>Get a set of title options plus a ready-to-paste description and tag list, written to earn the click and rank in search; not generic filler.</> },
        { icon: <FileText size={18} />, title: 'Video to blog post', body: <>One click turns the video into a full article on your WordPress: it pulls the transcript, structures the post, links the products you mentioned, and adds the affiliate disclosure.</> },
        { icon: <UserSquare size={18} />, title: 'Faces come from Photobooth', body: <>To put your likeness on a thumbnail, add your face in <strong>Photobooth</strong> (Face Models) first; then pick it in the Thumbnail style block here.</> },
      ]}
    />
  )
}

// ── Blog Post Generator ──────────────────────────────────────────────────────
export function ContentGuide() {
  return (
    <ToolGuide
      guideKey="content"
      icon={<FileText size={20} />}
      title="Your guide to the Blog Post Generator"
      subtitle="Turn a product link, a video, or a topic into a published review."
      sections={[
        { icon: <FileText size={18} />, title: 'What it makes', body: <>A complete, SEO-ready review article published straight to your WordPress: headline, intro, pros and cons, FAQ, internal links, image alt text, and the FTC affiliate disclosure; all done for you.</> },
        { icon: <Link2 size={18} />, title: 'Start from a link or a video', body: <>Paste an Amazon or product link, or a YouTube video, and MVP figures out the product, pulls the details, and writes the post. Your affiliate tag (or Geniuslink) is attached automatically.</> },
        { icon: <Mic size={18} />, title: 'It sounds like you', body: <>Posts are written in your trained voice (see Voice Training) so they read like your work, not a template.</> },
        { icon: <Send size={18} />, title: 'Published & indexed', body: <>The post goes live on your site. Head to SEO & Indexing to push it to Google, and to Social Push to share it to your channels.</> },
      ]}
    />
  )
}

// ── Comparisons ──────────────────────────────────────────────────────────────
export function ComparisonGuide() {
  return (
    <ToolGuide
      guideKey="comparison"
      icon={<Scale size={20} />}
      title="Your guide to Comparisons"
      subtitle="Head-to-head 'X vs Y' posts that win high-intent searches."
      sections={[
        { icon: <Scale size={18} />, title: 'Why comparison posts convert', body: <>Someone searching &ldquo;X vs Y&rdquo; is close to buying; they just need help deciding. These posts capture that high-intent traffic and send it to whichever product you recommend, with your affiliate link.</> },
        { icon: <Layers size={18} />, title: 'How to build one', body: <>Give it the two (or more) products you want to compare. MVP writes a balanced breakdown: a specs table, who each one is best for, and a clear verdict, published to your WordPress.</> },
        { icon: <ShieldCheck size={18} />, title: 'Honest by design', body: <>The post presents real trade-offs rather than forcing a winner, which builds trust and keeps readers on your site; the affiliate links and disclosure are still handled for you.</> },
      ]}
    />
  )
}

// ── Buying Guides ────────────────────────────────────────────────────────────
export function BuyingGuidesGuide() {
  return (
    <ToolGuide
      guideKey="buying-guides"
      icon={<BookOpen size={20} />}
      title="Your guide to Buying Guides"
      subtitle="'Best [thing] for [use case]' roundups that rank and earn."
      sections={[
        { icon: <BookOpen size={18} />, title: 'The workhorse of affiliate SEO', body: <>&ldquo;Best budget X&rdquo;, &ldquo;best X for beginners&rdquo;: these roundup posts pull steady search traffic and link out to several products, so one article can earn from many sales.</> },
        { icon: <Layers size={18} />, title: 'How to build one', body: <>Pick your topic and the products to feature. MVP writes the intro, the pick-by-pick breakdown, a quick comparison, and a buyer&rsquo;s FAQ, then publishes it with every product tagged with your affiliate link.</> },
        { icon: <TrendingUp size={18} />, title: 'Keep it fresh', body: <>Update the guide when prices move or a better product appears; fresh roundups hold their rankings longer.</> },
      ]}
    />
  )
}

// ── MVP x LTK ────────────────────────────────────────────────────────────────
export function LtkGuide() {
  return (
    <ToolGuide
      guideKey="ltk"
      icon={<Sparkles size={20} />}
      title="Your guide to MVP x LTK"
      subtitle="Turn an LTK link into an SEO blog post that drives traffic to it."
      sections={[
        { icon: <Link2 size={18} />, title: 'Paste your LTK link', body: <>Drop in a LikeToKnowIt link and MVP writes a full SEO article around it; the LTK link becomes the call to action in the post.</> },
        { icon: <FileText size={18} />, title: 'Why this helps', body: <>LTK pages do not rank in Google on their own. Wrapping one in a real blog post gives it a searchable home, so people find your LTK through search, not just your social feed.</> },
        { icon: <Send size={18} />, title: 'Publish and share', body: <>The post publishes to your WordPress; share it from Social Push and submit it in SEO & Indexing to start pulling traffic.</> },
      ]}
    />
  )
}

// ── Scriptwriter ─────────────────────────────────────────────────────────────
export function ScriptwriterGuide() {
  return (
    <ToolGuide
      guideKey="script"
      icon={<PenLine size={20} />}
      title="Your guide to Scriptwriter"
      subtitle="Draft video and short-form scripts in your voice, fast."
      sections={[
        { icon: <PenLine size={18} />, title: 'What it writes', body: <>Full scripts for your videos: hook, body, and call to action, structured to hold attention and lead viewers to your product links.</> },
        { icon: <Video size={18} />, title: 'Long-form or shorts', body: <>Use it for a full review video or a punchy 30-second short; tell it the product and the angle and it drafts the beats for you.</> },
        { icon: <Mic size={18} />, title: 'In your voice', body: <>Scripts follow your trained voice so they sound like you when you read them aloud.</> },
      ]}
    />
  )
}

// ── Newsletter ───────────────────────────────────────────────────────────────
export function NewsletterGuide() {
  return (
    <ToolGuide
      guideKey="newsletter"
      icon={<Mail size={20} />}
      title="Your guide to the Newsletter"
      subtitle="Turn readers into a list you own, and mail them your best picks."
      sections={[
        { icon: <Mail size={18} />, title: 'Why a list matters', body: <>Search and social can change overnight; an email list is an audience you own. MVP adds a signup form to your blog automatically so readers can subscribe.</> },
        { icon: <Send size={18} />, title: 'Build and send', body: <>Compose a short &ldquo;products I actually liked&rdquo; email, add your affiliate links, and send it to your subscribers. Great for recurring deal roundups.</> },
        { icon: <TrendingUp size={18} />, title: 'Keep it simple', body: <>A short, honest monthly email beats a long one nobody reads; consistency is what grows the list.</> },
      ]}
    />
  )
}

// ── Link in Bio ──────────────────────────────────────────────────────────────
export function LinkInBioGuide() {
  return (
    <ToolGuide
      guideKey="link-in-bio"
      icon={<Link2 size={20} />}
      title="Your guide to Link in Bio"
      subtitle="A shoppable grid of your products at one simple link."
      sections={[
        { icon: <Link2 size={18} />, title: 'Your shop, one link', body: <>You get a clean shop page at your own handle that you can drop into any social bio. Visitors tap through to your products, each with your affiliate link.</> },
        { icon: <ShoppingBag size={18} />, title: 'Fills itself in', body: <>It auto-populates from the products you have posted about, so your grid stays current without you rebuilding it by hand.</> },
        { icon: <Send size={18} />, title: 'Put it everywhere', body: <>Add the link to Instagram, TikTok, YouTube, and your other bios; it is the one destination that turns every follower into a potential sale.</> },
      ]}
    />
  )
}

// ── MVP x Levanta ────────────────────────────────────────────────────────────
export function LevantaGuide() {
  return (
    <ToolGuide
      guideKey="levanta"
      accent="#A3E635"
      icon={<ShoppingBag size={20} />}
      title="Your guide to MVP x Levanta"
      subtitle="Find brands paying higher Amazon commissions through Levanta."
      sections={[
        { icon: <ShoppingBag size={18} />, title: 'What Levanta adds', body: <>Levanta connects you with brands offering boosted commissions on Amazon products, often well above the standard rate. This finder surfaces those products so you can promote the ones that pay you more.</> },
        { icon: <ShieldCheck size={18} />, title: 'Connect your key', body: <>Add your Levanta API key in the panel at the top; with it connected, MVP can pull the brands and rates available to you.</> },
        { icon: <Bookmark size={18} />, title: 'Save and act', body: <>Save the products worth reviewing to your shortlist, then generate content for them like any other product; your links carry the higher payout.</> },
      ]}
    />
  )
}

// ── MVP x PartnerBoost ───────────────────────────────────────────────────────
export function PartnerBoostGuide() {
  return (
    <ToolGuide
      guideKey="partnerboost"
      accent="#A3E635"
      icon={<Store size={20} />}
      title="Your guide to MVP x PartnerBoost"
      subtitle="Discover brand partnerships and offers beyond Amazon."
      sections={[
        { icon: <Store size={18} />, title: 'Brands beyond Amazon', body: <>PartnerBoost opens up direct brand programs (non-Amazon), often with strong commissions and coupon offers you can pass to your audience.</> },
        { icon: <ShieldCheck size={18} />, title: 'Connect your account', body: <>Add your PartnerBoost credentials in the panel to load the brands and offers available to you.</> },
        { icon: <PenLine size={18} />, title: 'Turn offers into content', body: <>Found a brand worth promoting? Generate a post around it and share the offer link with your audience.</> },
      ]}
    />
  )
}

// ── Brand Profile ────────────────────────────────────────────────────────────
export function BrandProfileGuide() {
  return (
    <ToolGuide
      guideKey="brand"
      accent="#60A5FA"
      icon={<Palette size={20} />}
      title="Your guide to Brand Profile"
      subtitle="Set this once; it flows into your whole site and every post."
      sections={[
        { icon: <Palette size={18} />, title: 'Your brand, one place', body: <>Brand name, tagline, logo, colours, author bio, and headshot live here. Save them once and they apply across your blog header, footer, and generated content.</> },
        { icon: <Link2 size={18} />, title: 'Social links & contact', body: <>Add your YouTube, Instagram, TikTok, and the rest; they populate the footer icons on your site. Leave a field blank and clear it to remove that icon (a saved value that you clear now actually goes away).</> },
        { icon: <Tag size={18} />, title: 'Your Associates tag', body: <>Set your Amazon Associates tag here; every product link MVP creates for you is tagged with it automatically, so you never paste a tag by hand.</> },
        { icon: <ShieldCheck size={18} />, title: 'It syncs to WordPress', body: <>Saving pushes these details to your live site, so your header, footer, and about section always match what you set here.</> },
      ]}
    />
  )
}

// ── Voice Training ───────────────────────────────────────────────────────────
export function VoiceTrainingGuide() {
  return (
    <ToolGuide
      guideKey="voice"
      icon={<Mic size={20} />}
      title="Your guide to Voice Training"
      subtitle="Teach MVP to write like you, so nothing sounds like a template."
      sections={[
        { icon: <Mic size={18} />, title: 'Why train your voice', body: <>Generic AI copy reads generic. Train your voice and every blog post, script, and caption MVP writes takes on your tone, phrasing, and personality.</> },
        { icon: <FileText size={18} />, title: 'How to train it', body: <>Give MVP samples of your writing (a few of your own posts or paragraphs). It learns your style from them; the more representative the samples, the better the match.</> },
        { icon: <PenLine size={18} />, title: 'Where it shows up', body: <>Once trained, your voice is applied everywhere content is generated: the Blog Post Generator, Comparisons, Buying Guides, Scriptwriter, and Co-Pilot.</> },
      ]}
    />
  )
}

// ── Face Models (Photobooth) ─────────────────────────────────────────────────
export function FaceModelsGuide() {
  return (
    <ToolGuide
      guideKey="face-models"
      icon={<UserSquare size={20} />}
      title="Your guide to Face Models"
      subtitle="Add your likeness so your face can appear on thumbnails."
      sections={[
        { icon: <UserSquare size={18} />, title: 'What a face model is', body: <>Upload a few clear photos of yourself and MVP builds a likeness it can place onto generated thumbnails, so your face is on your content without a photoshoot every time.</> },
        { icon: <ImageIcon size={18} />, title: 'Get good results', body: <>Use clear, well-lit photos from a few angles, face visible, no heavy filters. Better source photos mean a better likeness.</> },
        { icon: <Youtube size={18} />, title: 'Use it in Co-Pilot', body: <>Once your face is added, pick it in the Thumbnail style block in YouTube Co-Pilot. Your plan sets how many separate faces (characters) you can keep.</> },
      ]}
    />
  )
}

// ── Social Launch Kit ────────────────────────────────────────────────────────
export function SocialLaunchKitGuide() {
  return (
    <ToolGuide
      guideKey="social-launch-kit"
      icon={<Rocket size={20} />}
      title="Your guide to the Social Launch Kit"
      subtitle="Stand up your social pages the right way, without the guesswork."
      sections={[
        { icon: <Rocket size={18} />, title: 'From blank page to launched', body: <>Starting a new page (like a Facebook deals page) is where most people stall. The Social Launch Kit walks you through setting up your social profiles properly so you can start posting right away.</> },
        { icon: <Send size={18} />, title: 'Then connect and post', body: <>Once your pages exist, connect them in Connect Socials, and use Social Push and Deal Radar&rsquo;s quick-post to start publishing to them.</> },
        { icon: <TrendingUp size={18} />, title: 'Consistency wins', body: <>A simple page posted to daily beats a perfect page posted to rarely; the kit gets you to the starting line so you can build the habit.</> },
      ]}
    />
  )
}

// ── SEO & Indexing ───────────────────────────────────────────────────────────
export function SeoGuide() {
  return (
    <ToolGuide
      guideKey="seo"
      accent="#C084FC"
      icon={<TrendingUp size={20} />}
      title="Your guide to SEO & Indexing"
      subtitle="Get your new posts seen by Google faster."
      sections={[
        { icon: <TrendingUp size={18} />, title: 'Why indexing matters', body: <>A post earns nothing until Google knows it exists. This tool submits your new posts for indexing so they can start appearing in search sooner instead of waiting to be found.</> },
        { icon: <Send size={18} />, title: 'How to use it', body: <>After you publish, come here and submit the post; MVP handles the request to Google for you.</> },
        { icon: <FileText size={18} />, title: 'Publish, then index', body: <>Make this the last step of your routine: generate the post, publish it, then submit it here. New content plus fast indexing is how rankings build.</> },
      ]}
    />
  )
}

// ── Ads ──────────────────────────────────────────────────────────────────────
export function AdsGuide() {
  return (
    <ToolGuide
      guideKey="ads"
      icon={<Megaphone size={20} />}
      title="Your guide to Ads"
      subtitle="Earn from display ads on top of your affiliate links."
      sections={[
        { icon: <Megaphone size={18} />, title: 'A second income stream', body: <>Affiliate links pay when someone buys; display ads pay for the visit itself. Running both means the same traffic earns two ways.</> },
        { icon: <ShieldCheck size={18} />, title: 'Set it up here', body: <>Connect your ad account and MVP places the ad slots on your site for you, including on your review posts.</> },
        { icon: <TrendingUp size={18} />, title: 'Balance is key', body: <>Keep ads tasteful so they do not bury your product links or slow the page; a clean site converts affiliate clicks better.</> },
      ]}
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
      icon={<MessageCircle size={20} />}
      title="Your guide to the MVP Help Desk"
      subtitle="Ask how to do anything in MVP, or get affiliate strategy advice."
      sections={[
        { icon: <MessageCircle size={18} />, title: 'Two jobs in one', body: <>Ask it how any part of MVP works (where a feature is, how to connect a site), and ask it strategy (what niche to chase, how to structure a review). It knows the product and the playbook.</> },
        { icon: <Search size={18} />, title: 'Skip the hunting', body: <>Instead of digging through menus, just describe what you want to do and it points you to the exact tool and steps.</> },
        { icon: <TrendingUp size={18} />, title: 'Coaching on tap', body: <>Stuck on what to post or how to grow? Ask. It gives concrete, affiliate-specific advice, not generic filler.</> },
      ]}
    />
  )
}

// ── Brand Deals (Collaborations) ─────────────────────────────────────────────
export function CollaborationsGuide() {
  return (
    <ToolGuide
      guideKey="collaborations"
      accent="#60A5FA"
      icon={<Handshake size={20} />}
      title="Your guide to Brand Deals"
      subtitle="We research the brand and write a pitch that sells your work."
      sections={[
        { icon: <FileText size={18} />, title: 'Fill it out once', body: <>Tell MVP the brand and the product you want to work with. It researches the brand and drafts a pitch email built around your real content and audience.</> },
        { icon: <Mail size={18} />, title: 'Ready to send', body: <>You get a polished outreach email you can send as-is or tweak; no staring at a blank page trying to sound professional.</> },
        { icon: <Handshake size={18} />, title: 'Build real partnerships', body: <>Direct brand deals pay more than standard commissions and can become repeat work. This is how you start that conversation.</> },
      ]}
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
      accent="#60A5FA"
      icon={<Wrench size={20} />}
      title="Your guide to Customize Blog"
      subtitle="The site bits Brand Profile does not cover."
      sections={[
        { icon: <Wrench size={18} />, title: 'Fine-tune your site', body: <>Set your Pick of the Day, place in-content ad slots, and edit footer links: the smaller site touches that live outside Brand Profile.</> },
        { icon: <Palette size={18} />, title: 'Brand Profile still leads', body: <>Your name, logo, colours, socials and Associates tag live in Brand Profile. This page is for everything else on the site.</> },
        { icon: <ShieldCheck size={18} />, title: 'Changes push live', body: <>Saving here updates your live WordPress site, so what you set is what visitors see.</> },
      ]}
    />
  )
}

// ── Deals Hub ────────────────────────────────────────────────────────────────
export function DealsHubGuide() {
  return (
    <ToolGuide
      guideKey="deals-hub"
      accent="#f43f5e"
      icon={<Zap size={20} />}
      title="Your guide to the Deals Hub"
      subtitle="Drop a link, get a timely deal post that converts."
      sections={[
        { icon: <Zap size={18} />, title: 'One link in, a deal post out', body: <>Paste any Amazon URL, Geniuslink, or ASIN and MVP writes a timely deal post: the savings, why it is worth it, and your affiliate link, published to your blog.</> },
        { icon: <Clock size={18} />, title: 'Baked-in urgency', body: <>Each deal post gets a thumbnail with the discount on it and a live countdown, so readers feel the clock ticking and act.</> },
        { icon: <Tag size={18} />, title: 'Your promo code, everywhere', body: <>If the deal has a coupon or promo code, MVP wires it into every call to action so readers never miss the discount.</> },
        { icon: <TrendingUp size={18} />, title: 'Great for social', body: <>Deal posts are perfect to push to Deal Radar and your social channels; timely savings are some of the most clicked content you can post.</> },
      ]}
    />
  )
}

// ── Shorts Studio ────────────────────────────────────────────────────────────
export function ShortsStudioGuide() {
  return (
    <ToolGuide
      guideKey="shorts-studio"
      icon={<Scissors size={20} />}
      title="Your guide to Shorts Studio"
      subtitle="One long video becomes a batch of subtitled vertical Shorts."
      sections={[
        { icon: <Scissors size={18} />, title: 'Long video to many Shorts', body: <>Point it at one long video and it cuts a batch of 15 to 30 second vertical clips from the best moments; no editing timeline needed.</> },
        { icon: <Type size={18} />, title: 'Word-for-word captions', body: <>Every Short gets burned-in subtitles synced to the audio, which is what makes short-form watchable with the sound off.</> },
        { icon: <Send size={18} />, title: 'Feed every platform', body: <>Use the clips for YouTube Shorts, Reels, and TikTok; more short-form surfaces mean more traffic back to your reviews and links.</> },
      ]}
    />
  )
}

// ── Clip Factory ─────────────────────────────────────────────────────────────
export function ClipFactoryGuide() {
  return (
    <ToolGuide
      guideKey="clip-factory"
      icon={<Video size={20} />}
      title="Your guide to Clip Factory"
      subtitle="Turn one long video into shoppable vertical shorts, then publish them."
      sections={[
        { icon: <Youtube size={18} />, title: 'Start with a source', body: <>Three ways in: pick one of your synced long videos below, paste a YouTube link, or upload an MP4. Source videos can be up to <strong>10 minutes</strong>; a short only ever uses a 15 to 30 second slice, so there is no need for anything longer. If you paste a link, tick the box confirming you own the video (or have the rights to use it).</> },
        { icon: <Scissors size={18} />, title: 'MVP finds the best moments', body: <>Hit <strong>Generate Clips</strong> and MVP reads the transcript, finds the strongest 15 to 30 second moments, and writes a hook for each. You get a set of suggested clips to pick from, scored by how well they stand alone; you are choosing from real options, not hoping one guess lands.</> },
        { icon: <Type size={18} />, title: 'Captions from what you actually said', body: <>Each clip is cut vertical (9:16) with word-for-word subtitles burned in, timed to your speech so they hit on the beat. Nothing is invented; the words are pulled straight from your transcript. Pick a caption style before you render.</> },
        { icon: <Tag size={18} />, title: 'Make it shoppable', body: <>Add a call to action and a product link right on the clip, so the short does not just collect views; it sends people to buy. Your affiliate link is wrapped for you, so every tap earns on your account.</> },
        { icon: <Send size={18} />, title: 'Render, then publish where you are', body: <>Render the clips you like, then push each finished short straight to <strong>Instagram, TikTok, or YouTube</strong> from here: no phone, no re-upload, no separate scheduler. Posted clips show a badge so you can see at a glance what has gone out.</> },
        { icon: <ShieldCheck size={18} />, title: 'A couple of ground rules', body: <>Only use your own videos or ones you have the rights to. If we cannot fetch a pasted link automatically (YouTube sometimes blocks it), you will be asked to upload the MP4 once and we take it from there. Rendering is a Pro feature, capped at <strong>50 finished shorts a month</strong>.</> },
      ]}
      footerNote={<><strong className="text-foreground">Longer videos are not better here.</strong> Clip Factory shines on tight, spoken review content: pick a video with faces and clear speech, and it does the rest.</>}
    />
  )
}

// ── Instagram Auto-DM ────────────────────────────────────────────────────────
export function InstagramDmGuide() {
  return (
    <ToolGuide
      guideKey="instagram-dm"
      accent="#E1306C"
      icon={<Instagram size={20} />}
      title="Your guide to Instagram Auto-DM"
      subtitle="A keyword comment triggers an automatic DM with your link."
      sections={[
        { icon: <MessageCircle size={18} />, title: 'Comment to unlock', body: <>Pick a keyword (like &ldquo;LINK&rdquo;). When someone comments it on your Instagram or Facebook post, MVP automatically sends them a DM with the right affiliate link.</> },
        { icon: <Zap size={18} />, title: 'Why it works', body: <>&ldquo;Comment LINK and I will send it&rdquo; drives a flood of comments (which boosts the post) and delivers your link privately, where people actually click.</> },
        { icon: <Link2 size={18} />, title: 'Set it and forget it', body: <>Once it is set up for a post, the DMs go out on their own around the clock; no sitting there replying by hand.</> },
      ]}
    />
  )
}

// ── Brand Inquiries ──────────────────────────────────────────────────────────
export function BrandInquiriesGuide() {
  return (
    <ToolGuide
      guideKey="brand-inquiries"
      accent="#60A5FA"
      icon={<Inbox size={20} />}
      title="Your guide to Brand Inquiries"
      subtitle="Where brand messages from your blog land."
      sections={[
        { icon: <Inbox size={18} />, title: 'Your inbound deals', body: <>When a brand reaches out through the &ldquo;Work with brands&rdquo; banner on your blog, their message shows up here so you never miss an opportunity.</> },
        { icon: <Handshake size={18} />, title: 'Turn interest into deals', body: <>These are warm leads: brands that found you and want to work with you. Reply, agree on terms, and cover their product.</> },
        { icon: <Palette size={18} />, title: 'Make the banner shine', body: <>The more your blog looks professional (Brand Profile, real reviews), the more brands trust the banner and reach out.</> },
      ]}
    />
  )
}

// ── Virtual Assistants (Agency) ──────────────────────────────────────────────
export function VirtualAssistantsGuide() {
  return (
    <ToolGuide
      guideKey="virtual-assistants"
      icon={<Users size={20} />}
      title="Your guide to Virtual Assistants"
      subtitle="Give a VA their own login without sharing yours."
      sections={[
        { icon: <Users size={18} />, title: 'Delegate safely', body: <>Invite a VA or contractor to help run your blog. They get their own login on your single Pro subscription; no sharing your password.</> },
        { icon: <KeyRound size={18} />, title: 'Scoped permissions', body: <>Decide what each person can do, so a VA can generate and publish content without touching billing or settings you want to keep private.</> },
        { icon: <TrendingUp size={18} />, title: 'Scale your output', body: <>With help on the repetitive work (generating posts, scheduling socials), you can run far more content than you could alone.</> },
      ]}
    />
  )
}
