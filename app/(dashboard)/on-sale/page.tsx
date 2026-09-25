/**
 * /on-sale — the old address of Encore. Kept so bookmarks, the dashboard's
 * older alerts and anything already shared still land on the page.
 */
import { redirect } from 'next/navigation'

export default function OnSaleMoved() {
  redirect('/encore')
}
