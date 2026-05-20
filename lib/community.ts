/**
 * Discord community.
 *
 * The server has Widget enabled, so we can pull a fresh instant
 * invite + the current online-presence list from /widget.json at
 * runtime. Pages embed the widget iframe for live presence.
 */

/** Public Discord server (guild) ID — community surfaces are gated
 *  on this being set, so deploying before the server exists is safe. */
export const DISCORD_SERVER_ID: string = '1505431539847135362'

/** Direct invite link the sidebar uses. Fixed canonical /invite URL
 *  — Discord redirects to a fresh invite owned by the server when
 *  the widget is enabled. */
export const DISCORD_INVITE_URL: string = DISCORD_SERVER_ID
  ? `https://discord.com/invite/${DISCORD_SERVER_ID}`
  : ''

/** Live presence widget iframe URL. Server-rendered into the
 *  Community page; dark variant chosen to match the dashboard. */
export const DISCORD_WIDGET_URL: string = DISCORD_SERVER_ID
  ? `https://discord.com/widget?id=${DISCORD_SERVER_ID}&theme=dark`
  : ''

/** Widget JSON endpoint — gives { instant_invite, members[], presence_count }.
 *  Cached + fetched server-side from the Community page to render a
 *  bigger member count + a recently-fetched invite. */
export const DISCORD_WIDGET_JSON_URL: string = DISCORD_SERVER_ID
  ? `https://discord.com/api/guilds/${DISCORD_SERVER_ID}/widget.json`
  : ''

export const COMMUNITY_LABEL = 'Community'
export const COMMUNITY_TOOLTIP =
  'Hang out with other creators, ask questions, share what works, give us feedback.'
