// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE SITE ADDRESS SWAPPED FOR ANOTHER IN TEXT MVP WROTE. Pure.
//
// A creator connected his WordPress site while it still lived on his host's
// temporary address (whitesmoke-viper-….hostingersite.com), so every YouTube
// description MVP wrote linked there. Once his real domain is connected, the
// admin swap (app/api/admin/domain-swap) rewrites those links: same paths,
// new address.

/** Hosts that are a web host's temporary or staging address, never a
 *  creator's real site. */
const TEMPORARY_HOSTS = [
  /\.hostingersite\.com$/i, /\.temp\.domains$/i, /\.wpcomstaging\.com$/i, /\.instawp\.(?:xyz|co|link)$/i,
  /\.myftpupload\.com$/i, /\.wpengine\.com$/i, /\.wpenginepowered\.com$/i, /\.kinsta\.cloud$/i,
  /\.cloudwaysapps\.com$/i, /\.mystagingwebsite\.com$/i, /\.tastewp\.com$/i, /\.local$/i,
]

export function isTemporaryHost(host: string): boolean {
  const h = normalizeHost(host)
  return !!h && TEMPORARY_HOSTS.some((rx) => rx.test(h))
}

/** "https://www.Example.com/path" → "example.com". "" when it is not a host. */
export function normalizeHost(input: string | null | undefined): string {
  let s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  s = s.split(/[/?#\s]/)[0].replace(/:\d+$/, '').replace(/\.$/, '')
  return /^(?=.{3,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(s) ? s : ''
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every link to `fromHost` (with or without www, http or https) now goes to
 *  `toHost` over https, path kept. A longer host that merely ends the same
 *  way ("notfrom.com") is left alone. */
export function swapDomain(text: string, fromHost: string, toHost: string): string {
  const from = normalizeHost(fromHost), to = normalizeHost(toHost)
  if (!text || !from || !to || from === to) return text
  const rx = new RegExp(`(?<![a-z0-9.-])(https?:\\/\\/)?(?:www\\.)?${esc(from)}(?![a-z0-9-]|\\.[a-z0-9])`, 'gi')
  return text.replace(rx, (_m, proto?: string) => `${proto ? 'https://' : ''}${to}`)
}

/** How many links to `host` the text carries. */
export function countHost(text: string | null | undefined, host: string): number {
  const h = normalizeHost(host)
  if (!text || !h) return 0
  const rx = new RegExp(`(?<![a-z0-9.-])(?:https?:\\/\\/)?(?:www\\.)?${esc(h)}(?![a-z0-9-]|\\.[a-z0-9])`, 'gi')
  return (String(text).match(rx) ?? []).length
}
