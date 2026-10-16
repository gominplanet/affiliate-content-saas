// The one place SCOUT can ask Chrome to read TikTok Creative Center and
// Instagram's hashtag counts. chrome.permissions.request only works from an
// extension page and only on a click, so the background opens this window
// and waits for the answer it sends back.
(function () {
  var ORIGINS = ['https://ads.tiktok.com/*', 'https://www.instagram.com/*']
  var said = document.getElementById('said')
  function answer(granted) {
    try { chrome.runtime.sendMessage({ type: 'SCOUT_HASHTAG_ALLOW_RESULT', granted: !!granted }) } catch (e) {}
    said.textContent = granted ? 'Allowed. Back to MVP.' : 'Not allowed. SCOUT will not read hashtags.'
    setTimeout(function () { window.close() }, granted ? 600 : 1500)
  }
  document.getElementById('allow').addEventListener('click', function () {
    chrome.permissions.request({ origins: ORIGINS }, function (granted) { answer(granted) })
  })
  document.getElementById('no').addEventListener('click', function () { answer(false) })
})()
