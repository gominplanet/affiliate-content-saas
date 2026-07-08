// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Social Launch Kit — shared platform specs for the "stand up a social presence
// in 5 minutes" feature. The generate API uses the character limits to size the
// copy; the page uses the image dimensions, deep links, and step-by-step guide.
// v1 covers Facebook Page + Pinterest (generate + guide — the user does the
// final clicks; MVP hands them every field and asset ready to paste).

export type LaunchPlatform = 'facebook' | 'pinterest'

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
    banner: { w: 820, h: 312, label: 'Cover photo', aspect: '16:9' },
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
    bioShortMax: 160,   // Pinterest "about"
    bioLongMax: 160,
    avatar: { w: 165, h: 165, label: 'Profile photo', aspect: '1:1' },
    boards: 5,
    steps: [
      { title: 'Create a free business account', detail: 'Open the link below. If you already have a personal Pinterest you can convert it or add a business account — business is free and unlocks analytics.' },
      { title: 'Set your name and photo', detail: 'Paste the business name and upload the profile photo MVP made (or your logo).' },
      { title: 'Write your about', detail: 'Paste the bio into your profile "About". Add your website and storefront links.' },
      { title: 'Claim your website', detail: 'In Settings → Claimed accounts, claim your blog domain. This ties every Pin back to you and unlocks site analytics.' },
      { title: 'Create your starter boards', detail: 'Make the boards MVP suggested and paste each board description. Keyword-rich descriptions are how Pinterest surfaces your Pins in search.' },
      { title: 'Pin your first products', detail: 'Add a few Pins linking to your reviews. Once connected in MVP, new posts can auto-Pin for you.' },
    ],
  },
}

export const LAUNCH_PLATFORM_LIST: PlatformSpec[] = [LAUNCH_PLATFORMS.facebook, LAUNCH_PLATFORMS.pinterest]

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
