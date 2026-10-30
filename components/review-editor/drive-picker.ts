'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Google's own file picker, for the review editor's takes (lib/google-drive).
// It runs in Google's window over the page, with the creator's own hour-long
// Drive token, so MVP never sees their Drive: only the file they choose, and
// choosing it through MVP's project (appId) is what lets MVP open it.

export interface PickedFile { id: string; name: string; bytes: number | null; mimeType: string }
export interface DriveFolderRef { id: string; name: string }
export interface DriveState {
  connected: boolean; email?: string | null; appId: string | null; key: string | null; token?: string; error?: string; needsSql?: boolean
  /** The creator's A-roll (talking takes) and B-roll folders. */
  aRoll?: DriveFolderRef | null; bRoll?: DriveFolderRef | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { gapi?: any; google?: any } }

let loading: Promise<void> | null = null
/** The video files a phone or camera makes. */
const VIDEO_TYPES = 'video/mp4,video/quicktime,video/x-m4v,video/webm,video/3gpp,video/x-msvideo,video/x-matroska,video/mpeg'

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
    // YOUR OWN DRIVE, NOT EVERYTHING SHARED WITH YOU (Seb, 2026-10-30: "I'm
    // seeing old videos, videos that don't belong to me"). The first view
    // opens in My Drive with its folders; the second is your own videos,
    // newest first. Files others shared with you are in neither.
    const mine = new g.picker.DocsView(g.picker.ViewId.DOCS).setParent('root').setIncludeFolders(true).setSelectFolderEnabled(false)
      .setMimeTypes(VIDEO_TYPES).setMode(g.picker.DocsViewMode.LIST).setLabel('My Drive')
    const recent = new g.picker.DocsView(g.picker.ViewId.DOCS_VIDEOS).setOwnedByMe(true).setMode(g.picker.DocsViewMode.LIST).setLabel('My videos')
    let b = new g.picker.PickerBuilder()
      .setAppId(o.appId)
      .setOAuthToken(o.token)
      .addView(mine)
      .addView(recent)
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

type Base = { token: string; appId: string; key: string | null; title: string }

function open(o: Base, views: any[], multi: boolean, read: (docs: any[]) => void) {
  const g = window.google
  let b = new g.picker.PickerBuilder().setAppId(o.appId).setOAuthToken(o.token).setTitle(o.title)
  for (const v of views) b = b.addView(v)
  if (multi) b = b.enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
  if (o.key) b = b.setDeveloperKey(o.key)
  b = b.setCallback((data: any) => {
    const action = data?.[g.picker.Response.ACTION]
    if (action === g.picker.Action.PICKED) read(data[g.picker.Response.DOCUMENTS] || [])
    else if (action === g.picker.Action.CANCEL) read([])
  })
  b.build().setVisible(true)
}

/** Choose a folder in My Drive (the A-roll or B-roll folder). */
export async function pickFolder(o: Base): Promise<DriveFolderRef | null> {
  await loadPicker()
  const g = window.google
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS).setParent('root').setIncludeFolders(true).setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder').setMode(g.picker.DocsViewMode.LIST).setLabel('My Drive')
    open(o, [view], false, (docs) => {
      const d = docs[0]
      resolve(d ? { id: d[g.picker.Document.ID], name: d[g.picker.Document.NAME] || 'Folder' } : null)
    })
  })
}

/** Choose many videos at once, the picker opened in one folder: a batch
 *  from the A-roll or B-roll folder (Shift or Ctrl to pick several). */
export async function pickMany(o: Base & { folderId: string }): Promise<PickedFile[]> {
  await loadPicker()
  const g = window.google
  return new Promise((resolve) => {
    const view = new g.picker.DocsView(g.picker.ViewId.DOCS).setParent(o.folderId).setIncludeFolders(false)
      .setMimeTypes(VIDEO_TYPES).setMode(g.picker.DocsViewMode.LIST)
    open(o, [view], true, (docs) => resolve(docs.map((d: any) => ({
      id: d[g.picker.Document.ID], name: d[g.picker.Document.NAME] || 'video', bytes: Number(d.sizeBytes) || null, mimeType: d[g.picker.Document.MIME_TYPE] || 'video/mp4',
    }))))
  })
}
