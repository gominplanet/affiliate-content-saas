/* MVP Affiliate Theme — minimal JS, no dependencies */
(function () {
  'use strict';

  // ── Mobile menu toggle ─────────────────────────────────────────────────────
  var menuToggle = document.querySelector('[data-mvp-menu-toggle]');
  var header = document.querySelector('.mvp-header');
  if (menuToggle && header) {
    menuToggle.addEventListener('click', function () {
      header.classList.toggle('mvp-header-open');
      var open = header.classList.contains('mvp-header-open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ── Search drawer toggle ───────────────────────────────────────────────────
  var searchToggle = document.querySelector('[data-mvp-search-toggle]');
  var searchDrawer = document.querySelector('[data-mvp-search]');
  if (searchToggle && searchDrawer) {
    searchToggle.addEventListener('click', function () {
      var isHidden = searchDrawer.hasAttribute('hidden');
      if (isHidden) {
        searchDrawer.removeAttribute('hidden');
        var input = searchDrawer.querySelector('input[type="search"]');
        if (input) setTimeout(function () { input.focus(); }, 50);
      } else {
        searchDrawer.setAttribute('hidden', '');
      }
    });
  }

  // ── Sticky header on scroll ────────────────────────────────────────────────
  if (header) {
    var lastY = 0;
    function onScroll() {
      var y = window.scrollY || window.pageYOffset;
      if (y > 8) {
        header.classList.add('mvp-header-scrolled');
      } else {
        header.classList.remove('mvp-header-scrolled');
      }
      lastY = y;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── About band: Read more / Read less toggle ───────────────────────────────
  var aboutBtn = document.querySelector('.mvp-about-readmore');
  if (aboutBtn) {
    var aboutRest = document.querySelector('.mvp-about-bio-rest');
    aboutBtn.addEventListener('click', function () {
      var expanded = aboutBtn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        if (aboutRest) aboutRest.setAttribute('hidden', '');
        aboutBtn.setAttribute('aria-expanded', 'false');
        aboutBtn.textContent = 'Read more';
      } else {
        if (aboutRest) aboutRest.removeAttribute('hidden');
        aboutBtn.setAttribute('aria-expanded', 'true');
        aboutBtn.textContent = 'Read less';
      }
    });
  }
})();
