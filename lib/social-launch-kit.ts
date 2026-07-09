// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Social Launch Kit — shared platform specs for the "stand up a social presence
// in 5 minutes" feature. The generate API uses the character limits to size the
// copy; the page uses the image dimensions, deep links, and step-by-step guide.
// Covers Facebook Page, Pinterest, X (Twitter), Threads, Bluesky and LinkedIn
// (generate + guide — the user does the final clicks; MVP hands them every field
// and asset ready to paste).

export type LaunchPlatform = 'facebook' | 'pinterest' | 'twitter' | 'threads' | 'bluesky' | 'linkedin'

export interface LaunchImageSpec { w: number; h: number; label: string; aspect: string }
export interface LaunchStep { title: string; detail: string }

export interface PlatformSpec {
  id: LaunchPlatform
  label: string
  blurb: string
  createUrl: string
  createLabel: string
  nameMax: number
  bioShortMax: number   // tagline / intro line
  bioLongMax: number    // about / description
  banner?: LaunchImageSpec
  avatar: LaunchImageSpec
  /** Pinterest only: how many starter boards to propose. */
  boards?: number
  steps: LaunchStep[]
}

export const LAUNCH_PLATFORMS: Record<LaunchPlatform, PlatformSpec> = {
  facebook: {
    id: 'facebook',
    label: 'Facebook Page',
    blurb: 'A public Page (not your personal profile) is where you post reviews, can run the occasional ad, and build an audience you own.',
    createUrl: 'https://www.facebook.com/pages/create',
    createLabel: 'Create your Facebook Page',
    nameMax: 50,
    bioShortMax: 101,   // Page "bio"
    bioLongMax: 250,    // Page "about" intro
    // FB recommends uploading 820×360 (displays 820×312 desktop / 640×360 mobile);
    // keep the key visual centered so mobile cropping is safe.
    banner: { w: 820, h: 360, label: 'Cover photo', aspect: '16:9' },
    avatar: { w: 320, h: 320, label: 'Profile picture', aspect: '1:1' },
    steps: [
      { title: 'Start a new Page', detail: 'Open the create link below and choose a Page (not a personal profile). You must be logged into a personal Facebook account first — the Page attaches to it but stays separate.' },
      { title: 'Name it and pick a category', detail: 'Paste the Page name and choose the category MVP suggested.' },
      { title: 'Add your profile picture', detail: 'Upload the avatar MVP made (or your own logo). It shows as a circle, so keep the important part centered.' },
      { title: 'Add your cover photo', detail: 'Upload the cover banner MVP made. Phones crop the edges, so the key part stays centered.' },
      { title: 'Fill in the bio and about', detail: 'Paste the short bio into "Bio" and the longer version into "About". Add your website or storefront link.' },
      { title: 'Publish your first post', detail: 'Paste the starter post so the Page is not empty on day one. Then connect it in MVP’s Connect Socials to auto-post from here.' },
    ],
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    blurb: 'Pinterest is a search engine, not a feed — Pins keep sending traffic for months. A free business account unlocks analytics and lets you claim your site.',
    createUrl: 'https://www.pinterest.com/business/create/',
    createLabel: 'Create your Pinterest business account',
    nameMax: 30,
    // Pinterest has ONE bio field ("Introduce yourself" in Edit profile), 255
    // chars. bioShort is an optional tighter version; bioLong = the real field.
    bioShortMax: 160,
    bioLongMax: 255,
    // Pinterest profile cover = a 16:9 hero image (recommended 800×450; we make
    // it larger for crispness). Only ~8% is trimmed from the 1.5:1 render, so it
    // uses the rich gpt-image cover path (like Facebook), NOT the wide compositor.
    banner: { w: 1600, h: 900, label: 'Profile cover', aspect: '16:9' },
    avatar: { w: 165, h: 165, label: 'Profile photo', aspect: '1:1' },
    boards: 5,
    steps: [
      { title: 'Create a free business account', detail: 'Open the link below. If you already have a personal Pinterest you can convert it or add a business account — business is free and unlocks analytics.' },
      { title: 'Set your name and photo', detail: 'Paste the business name and upload the profile photo MVP made (or your logo).' },
      { title: 'Add your profile cover', detail: 'Open Edit profile → the cover photo at the top → upload the cover image MVP made. Keep it uncropped; Pinterest centres it automatically.' },
      { title: 'Write your bio', detail: 'Open Edit profile → "Introduce yourself" (up to 255 characters) and paste the About that MVP wrote. Add your website and storefront links.' },
      { title: 'Claim your website', detail: 'In Settings → Claimed accounts, claim your blog domain. This ties every Pin back to you and unlocks site analytics.' },
      { title: 'Create your starter boards', detail: 'Make the boards MVP suggested and paste each board description. Keyword-rich descriptions are how Pinterest surfaces your Pins in search.' },
      { title: 'Pin your first products', detail: 'Add a few Pins linking to your reviews. Once connected in MVP, new posts can auto-Pin for you.' },
    ],
  },
  twitter: {
    id: 'twitter',
    label: 'X (Twitter)',
    blurb: 'Real-time reach and reply threads — great for quick takes, deal alerts, and driving clicks to your reviews with a link in your bio.',
    createUrl: 'https://x.com/i/flow/signup',
    createLabel: 'Create your X account',
    nameMax: 50,         // display name
    bioShortMax: 120,    // a tighter tagline
    bioLongMax: 160,     // the real bio field is 160 chars
    banner: { w: 1500, h: 500, label: 'Header photo', aspect: '3:1' },
    avatar: { w: 400, h: 400, label: 'Profile photo', aspect: '1:1' },
    steps: [
      { title: 'Create or open your account', detail: 'Sign up, or log into an existing X account. A brand handle you own beats posting from a personal one.' },
      { title: 'Set your name and @handle', detail: 'Paste the display name and pick a handle — X handles are max 15 characters, so trim the suggestion if it’s longer.' },
      { title: 'Upload your photo and header', detail: 'Add the avatar (shows as a circle) and the header banner MVP made. Keep the key part centred.' },
      { title: 'Write your bio + add your link', detail: 'Paste the bio (160 characters) and put your website/storefront in the Website field so every visitor has a way through.' },
      { title: 'Post your intro + pin it', detail: 'Post the starter tweet, then pin it to your profile so it’s the first thing visitors see. Connect X in MVP to auto-post.' },
    ],
  },
  threads: {
    id: 'threads',
    label: 'Threads',
    blurb: 'Text-first conversations tied to your Instagram. Fast-growing and friendly reach — good for quick reviews, questions, and behind-the-scenes.',
    createUrl: 'https://www.threads.com/',
    createLabel: 'Open Threads',
    nameMax: 30,
    bioShortMax: 150,
    bioLongMax: 500,     // Threads bio field
    // Threads has no cover image — profile is avatar + bio only.
    avatar: { w: 400, h: 400, label: 'Profile photo', aspect: '1:1' },
    steps: [
      { title: 'Sign in with Instagram', detail: 'Threads runs on an Instagram account — if you don’t have one for the brand, create a free Instagram first, then open Threads and log in with it.' },
      { title: 'Set your name and bio', detail: 'Paste the display name and the bio (up to 500 characters). Add your website link — it’s clickable on Threads.' },
      { title: 'Add your profile photo', detail: 'Upload the avatar MVP made (or your logo). It shows as a circle.' },
      { title: 'Post your first thread', detail: 'Paste the starter post so your profile isn’t empty, then reply to a few bigger accounts in your niche to get seen.' },
    ],
  },
  bluesky: {
    id: 'bluesky',
    label: 'Bluesky',
    blurb: 'An open, fast-growing Twitter-style network — early-adopter and reviews-friendly. You can even use your own domain as your handle for instant credibility.',
    createUrl: 'https://bsky.app/',
    createLabel: 'Create your Bluesky account',
    nameMax: 64,         // display name
    bioShortMax: 150,
    bioLongMax: 256,     // description field
    banner: { w: 1500, h: 500, label: 'Banner', aspect: '3:1' },
    avatar: { w: 400, h: 400, label: 'Avatar', aspect: '1:1' },
    steps: [
      { title: 'Create a free account', detail: 'Sign up at bsky.app — you’ll start with a handle like yourname.bsky.social.' },
      { title: 'Set your display name + images', detail: 'Open Edit profile, paste the display name, and upload the avatar + banner MVP made.' },
      { title: 'Write your bio', detail: 'Paste the description (up to 256 characters) and include your website link.' },
      { title: '(Optional) Use your own domain as your handle', detail: 'In Settings → Handle you can switch your handle to your blog domain (e.g. yourbrand.com). Bluesky shows you the DNS record to add — it’s a great trust signal.' },
      { title: 'Post your intro', detail: 'Paste the starter post, then follow and reply to a few accounts in your niche to seed reach.' },
    ],
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    blurb: 'The professional network — builds authority and helps with brand deals and partnerships. Optimise your profile as a creator (and spin up a Company Page later).',
    createUrl: 'https://www.linkedin.com/',
    createLabel: 'Open LinkedIn',
    nameMax: 60,
    bioShortMax: 220,    // headline
    bioLongMax: 2600,    // About section
    // Personal-profile cover is 1584×396 (4:1) — very wide and short, so the
    // key visual must stay tight in the centre band.
    banner: { w: 1584, h: 396, label: 'Cover image', aspect: '4:1' },
    avatar: { w: 400, h: 400, label: 'Profile photo', aspect: '1:1' },
    steps: [
      { title: 'Open your profile (or sign up)', detail: 'Use a personal LinkedIn profile as your creator home. If you don’t have one, create a free account first.' },
      { title: 'Set your headline', detail: 'Paste the headline (up to 220 characters) — it’s the tagline under your name and the most-seen line on the platform.' },
      { title: 'Write your About section', detail: 'Open the About section and paste the longer bio MVP wrote. Add your website/storefront in Contact info and the Featured section.' },
      { title: 'Add your photo and cover', detail: 'Upload the avatar and the wide cover image MVP made (Edit intro → the camera icons). The cover is very wide, so the key part stays centred.' },
      { title: 'Post your intro + (optional) Page', detail: 'Share the starter post. If you want a fully brand-owned presence, you can also create a free LinkedIn Company Page from the same account.' },
    ],
  },
}

export const LAUNCH_PLATFORM_LIST: PlatformSpec[] = [
  LAUNCH_PLATFORMS.facebook,
  LAUNCH_PLATFORMS.pinterest,
  LAUNCH_PLATFORMS.twitter,
  LAUNCH_PLATFORMS.threads,
  LAUNCH_PLATFORMS.bluesky,
  LAUNCH_PLATFORMS.linkedin,
]

/** The generated copy kit for one platform. Every string is scrubbed server-side. */
export interface SocialKit {
  names: string[]
  handles: string[]
  bioShort: string
  bioLong: string
  category: string
  keywords: string[]
  firstPost: string
  boards?: { name: string; description: string }[]
}
