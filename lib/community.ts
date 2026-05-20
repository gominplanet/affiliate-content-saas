/**
 * Discord community link. Surfaced in the sidebar (Community entry)
 * and anywhere else we want to point users at the server.
 *
 * Swap DISCORD_INVITE_URL with the real permanent-invite link once
 * the server is set up — leaving it empty hides every community
 * surface in the app, so deploying before the invite is ready is safe.
 */

export const DISCORD_INVITE_URL: string =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() || ''

export const COMMUNITY_LABEL = 'Community'
export const COMMUNITY_TOOLTIP =
  'Hang out with other creators, ask questions, share what works, give us feedback.'
