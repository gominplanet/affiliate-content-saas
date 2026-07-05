/**
 * SCOUT ↔ MVP id bridge.
 *
 * Runs ONLY on the MVP app (www.mvpaffiliate.io). Its single job: tell the page
 * this SCOUT's real extension id via window.postMessage, so the app can message
 * THIS install — whatever its id is:
 *   • Web Store build      → blpmlneliggaekangckpgknphpacapkg
 *   • keyed sideload build → inpklaogoifhgaimbnlgmijnnjkopnlc
 *   • an unpacked dev build → a RANDOM id Chrome assigns (unknowable in advance)
 *
 * Without this, the app could only reach the two hardcoded ids, so a dev/test
 * build with a random id looked "not installed" even though it was right there.
 * The bridge makes the app find whatever is installed — no id guessing.
 *
 * Security: this only runs on our own first-party page, only ANNOUNCES an id
 * (never receives secrets), and the app treats a discovered id as ADDITIVE to
 * the known ids + validates its shape — a spoofed id can at worst make the app
 * message a dead id (a harmless no-op), never drop a legitimate one.
 */
(function () {
  'use strict'

  var ID = null
  var VER = null
  try { ID = chrome.runtime.id } catch (e) { /* no runtime → nothing to announce */ }
  try { VER = chrome.runtime.getManifest().version } catch (e) { /* older shell */ }
  if (!ID) return

  function announce() {
    try {
      window.postMessage(
        { source: 'MVP_SCOUT', type: 'SCOUT_HELLO', extensionId: ID, version: VER },
        window.location.origin
      )
    } catch (e) { /* ignore */ }
  }

  // Answer the app's explicit "who's there?" (covers the app loading AFTER us).
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return
    var d = ev.data
    if (d && d.source === 'MVP_APP' && d.type === 'SCOUT_WHO') announce()
  })

  // Shout proactively too: at document_start the app's listener isn't attached
  // yet, so repeat a few times as the SPA hydrates, then stop.
  announce()
  var n = 0
  var t = setInterval(function () {
    announce()
    if (++n >= 6) clearInterval(t)
  }, 700)
})()
