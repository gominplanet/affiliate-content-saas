// The one place SCOUT can ask Chrome for Facebook access. chrome.permissions.
// request only works from an extension page and only on a click, so the
// background opens this window and waits for the answer it sends back.
(function () {
  var ORIGINS = ['https://*.facebook.com/*']
  var said = document.getElementById('said')
  function answer(granted) {
    try { chrome.runtime.sendMessage({ type: 'SCOUT_FB_ALLOW_RESULT', granted: !!granted }) } catch (e) {}
    said.textContent = granted ? 'Allowed. SCOUT is opening your Group now.' : 'Not allowed. Nothing was filled; you can paste the post yourself.'
    setTimeout(function () { window.close() }, granted ? 600 : 1500)
  }
  document.getElementById('allow').addEventListener('click', function () {
    chrome.permissions.request({ origins: ORIGINS }, function (granted) { answer(granted) })
  })
  document.getElementById('no').addEventListener('click', function () { answer(false) })
})()
