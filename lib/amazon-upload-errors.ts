// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What an Amazon upload failure means, in the creator's words.
//
// SCOUT reports Chrome's and Amazon's own sentences, and the board showed them
// as they came: "Could not establish connection. Receiving end does not exist."
// That is Chrome saying SCOUT's page script was not there, and in practice it
// means the store's upload page never opened (Amazon sent the tab to its
// sign-in page, where SCOUT has no access). Said as such, with the one thing
// that fixes it. Anything not recognised is passed through untouched.
import { marketByDomain } from '@/lib/markets'

export function explainAmazonUpload(raw: string | null | undefined, domain: string): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  const country = marketByDomain(domain)?.country ?? domain
  const store = `amazon.${domain.replace(/^amazon\./, '')}`
  if (/receiving end does not exist|could not establish connection/i.test(s)) {
    return `SCOUT could not open Amazon ${country}'s upload page. That usually means this Chrome is not signed in to ${store} with your Creator account: open ${store}, sign in, then send again.`
  }
  if (/creator session token|ctx:dom:csrf|slatetoken/i.test(s)) {
    return `Signed in to ${store}, but Amazon did not open your Creator tools there. Open ${store}/create/post while signed in: if it asks you to join or finish setting up as a creator for ${country}, do that, then send again.`
  }
  if (/s3 put timed out|upload-video\].*timed out/i.test(s)) {
    return `The video took too long to reach Amazon ${country} and was stopped part way. Nothing is listed there yet; sending again starts it fresh.`
  }
  if (/^Could not open the Amazon Creator Hub tab/i.test(s)) {
    return `Chrome would not open a tab for Amazon ${country}. Send again; if it keeps happening, restart Chrome.`
  }
  return s
}
