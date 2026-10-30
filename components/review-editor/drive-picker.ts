'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Google's own file picker, for the review editor's takes (lib/google-drive).
// It runs in Google's window over the page, with the creator's own hour-long
// Drive token, so MVP never sees their Drive: only the file they choose, and
// choosing it through MVP's project (appId) is what lets MVP open it.

export interface PickedFile { id: string; name: string; bytes: number | null; mimeType: string }
export interface DriveState { connected: boolean; email?: string | null; appId: string | null; key: string | null; token?: string; error?: string; needsSql?: boolean }

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { gapi?: any; google?: any } }

let loading: Promise<void> | null = null

/** Google's picker script, loaded once. */
function loadPicker(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.google?.picker) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const done = () => window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Google’s picker did not load.')) })
    if (window.gapi) return done()
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.onload = done
    s.onerror = () => { loading = null; reject(new Error('Google’s picker did not load. Check that nothing is blocking google.com.')) }
    document.head.appendChild(s)
  })
  return loading
}

/** Open the picker on the creator's videos. Resolves with the file chosen,
 *  or null when they closed it without choosing. */
export async function pickFromDrive(o: { token: string; appId: string; key: string | null; title: string }): Promise<PickedFile | null> {
  await loadPicker()
  const g = window.google
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS_VIDEOS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(g.picker.DocsViewMode.LIST)
    let b = new g.picker.PickerBuilder()
      .setAppId(o.appId)
      .setOAuthToken(o.token)
      .addView(view)
      .setTitle(o.title)
      .setCallback((data: any) => {
        const action = data?.[g.picker.Response.ACTION]
        if (action === g.picker.Action.PICKED) {
          const doc = data[g.picker.Response.DOCUMENTS]?.[0]
          resolve(doc ? { id: doc[g.picker.Document.ID], name: doc[g.picker.Document.NAME] || 'video', bytes: Number(doc.sizeBytes) || null, mimeType: doc[g.picker.Document.MIME_TYPE] || 'video/mp4' } : null)
        } else if (action === g.picker.Action.CANCEL) resolve(null)
      })
    if (o.key) b = b.setDeveloperKey(o.key)
    b.build().setVisible(true)
  })
}
