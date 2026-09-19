// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH ACCOUNT EACH BLOG POSTS TO.
//
// A creator with one blog never sees this. It renders nothing until there is a
// second site, because until then there is no routing question to answer and a
// settings panel that only restates the obvious is one more thing to read past.
//
// The dropdown's empty option is a real choice, not a placeholder: it means
// "use my main account", which is what every site did before this existed and
// what most sites will keep doing. So the row always shows what will actually
// happen, including when nothing has been set.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

interface Site { id: string; label: string; url: string | null; isDefault: boolean }
interface Account { id: string; platform: string; displayName: string | null; externalId: string; isDefault: boolean }
interface Mapping { siteId: string; platform: string; socialAccountId: string }

const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
}

export default function SiteSocialRouting() {
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [platforms, setPlatforms] = useState<string[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [applies, setApplies] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/site-social-defaults')
      const d = await r.json()
      if (!r.ok || !d?.ok) { setApplies(false); return }
      setSites(d.sites ?? [])
      setAccounts(d.accounts ?? [])
      setPlatforms(d.platforms ?? [])
      setMappings(d.defaults ?? [])
      setApplies(!!d.routingApplies)
    } catch {
      // A failed read shows nothing rather than an empty panel that looks like
      // "you have no sites". Silence here is honest: we do not know.
      setApplies(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const chosenFor = (siteId: string, platform: string) =>
    mappings.find((m) => m.siteId === siteId && m.platform === platform)?.socialAccountId ?? ''

  const accountsFor = (platform: string) => accounts.filter((a) => a.platform === platform)

  const fallbackNameFor = (platform: string) => {
    const d = accountsFor(platform).find((a) => a.isDefault)
    return d ? (d.displayName || d.externalId) : null
  }

  async function save(siteId: string, platform: string, socialAccountId: string) {
    const key = `${siteId}:${platform}`
    setSaving(key)
    // Optimistic, then reconciled by the reload below. A dropdown that snaps
    // back while the request is in flight reads as a rejected choice.
    const before = mappings
    setMappings((prev) => {
      const rest = prev.filter((m) => !(m.siteId === siteId && m.platform === platform))
      return socialAccountId ? [...rest, { siteId, platform, socialAccountId }] : rest
    })
    try {
      const r = await fetch('/api/site-social-defaults', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, platform, socialAccountId: socialAccountId || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.ok) {
        setMappings(before)
        toast.error(d?.error || 'Could not save that. Nothing was changed.')
        return
      }
      toast.success('Saved')
    } catch {
      setMappings(before)
      toast.error('Could not reach the server. Nothing was changed.')
    } finally {
      setSaving(null)
    }
  }

  if (loading || !applies) return null

  // Only platforms the creator actually has more than one account on are worth
  // a column. With a single Facebook page there is nothing to route it to.
  const routable = platforms.filter((p) => accountsFor(p).length > 1)
  if (routable.length === 0) return null

  return (
    <section className="mt-8 rounded-2xl border border-black/10 dark:border-white/10 p-5">
      <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
        Where each blog posts
      </h2>
      <p className="mt-1 text-[13px] leading-snug text-[#6e6e73] dark:text-[#ebebf0]">
        You have more than one blog and more than one account on at least one platform.
        Pick which account each blog posts to. Leave a blog set to your main account and it
        behaves exactly as it does today.
      </p>

      <div className="mt-5 flex flex-col gap-5">
        {sites.map((site) => (
          <div key={site.id} className="rounded-xl bg-black/[0.02] dark:bg-white/[0.04] p-4">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{site.label}</span>
              {site.url && (
                <span className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0]">
                  {site.url.replace(/^https?:\/\//, '')}
                </span>
              )}
            </div>

            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              {routable.map((platform) => {
                const key = `${site.id}:${platform}`
                const chosen = chosenFor(site.id, platform)
                const fallback = fallbackNameFor(platform)
                return (
                  <label key={platform} className="flex flex-col gap-1">
                    <span className="text-[12px] font-medium text-[#6e6e73] dark:text-[#ebebf0]">
                      {PLATFORM_LABEL[platform] ?? platform}
                    </span>
                    <select
                      value={chosen}
                      disabled={saving === key}
                      onChange={(e) => save(site.id, platform, e.target.value)}
                      className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-black/30 px-3 py-2 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-60"
                    >
                      {/* Names the account this falls back to rather than
                          saying "Default", so the row states what will happen
                          instead of naming the rule that decides it. */}
                      <option value="">
                        {fallback ? `Use my main account (${fallback})` : 'Use my main account'}
                      </option>
                      {accountsFor(platform).map((a) => (
                        <option key={a.id} value={a.id}>{a.displayName || a.externalId}</option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
