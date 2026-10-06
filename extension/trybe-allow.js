// The one place SCOUT can ask Chrome for TRYBE access. chrome.permissions.
// request only works from an extension page and only on a click, so the
// background opens this window and waits for the answer it sends back.
(function () {
  var ORIGINS = ['https://jointrybe.com/*', 'https://*.jointrybe.com/*']
  var said = document.getElementById('said')
  function answer(granted) {
    try { chrome.runtime.sendMessage({ type: 'SCOUT_TRYBE_ALLOW_RESULT', granted: !!granted }) } catch (e) {}
    said.textContent = granted ? 'Allowed. Back to MVP.' : 'Not allowed. SCOUT will not open TRYBE.'
    setTimeout(function () { window.close() }, granted ? 600 : 1500)
  }
  document.getElementById('allow').addEventListener('click', function () {
    chrome.permissions.request({ origins: ORIGINS }, function (granted) { answer(granted) })
  })
  document.getElementById('no').addEventListener('click', function () { answer(false) })
})()
