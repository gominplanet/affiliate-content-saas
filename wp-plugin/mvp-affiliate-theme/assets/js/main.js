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

  // ── Header menu: one row, or its own row when it cannot fit ────────────────
  // A long tagline plus the header pills squeezed the category menu into a
  // single column on desktop. Measured in the one-row layout: if the menu
  // wraps, it moves to its own full-width row under the brand. Re-measured
  // when the width changes and when the platform plugin injects its pills.
  var headerInner = header && header.querySelector('.mvp-header-inner');
  var navMenu = header && header.querySelector('.mvp-nav-menu');
  if (headerInner && navMenu) {
    var fitHeaderNav = function () {
      if (window.innerWidth <= 900) { header.classList.remove('mvp-header--two-row'); return; }
      header.classList.remove('mvp-header--two-row');
      var items = navMenu.children;
      var wraps = false;
      if (items.length > 1) {
        var top = items[0].offsetTop;
        for (var i = 1; i < items.length; i++) {
          if (Math.abs(items[i].offsetTop - top) > 4) { wraps = true; break; }
        }
      }
      if (wraps) header.classList.add('mvp-header--two-row');
    };
    var fitTimer = null;
    var lastWidth = 0;
    var scheduleFit = function () {
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(fitHeaderNav, 60);
    };
    fitHeaderNav();
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      scheduleFit();
    });
    window.addEventListener('load', fitHeaderNav);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeaderNav);
    if (window.MutationObserver) {
      new MutationObserver(scheduleFit).observe(headerInner, { childList: true });
    }
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

  // ── Comparison tables: label cells for the mobile card transform ───────────
  // The CSS at @media (max-width: 768px) renders each <tr> as a card and
  // prepends each non-first cell with content: attr(data-label). We populate
  // data-label here by walking <thead th> in column order — falls back to
  // an empty label if the table has no <thead>, which still looks fine
  // (no chip above the value, just the value).
  document.querySelectorAll('.mvp-single-body table').forEach(function (table) {
    var headers = [];
    table.querySelectorAll('thead th').forEach(function (th) { headers.push((th.textContent || '').trim()); });
    if (headers.length === 0) return;
    table.querySelectorAll('tbody tr').forEach(function (row) {
      row.querySelectorAll('td').forEach(function (td, i) {
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', headers[i] || '');
      });
    });
  });

  // ── Auto Table of Contents — REMOVED 2026-06-05 ───────────────────────────
  // User feedback: the "In this review" TOC box was wasting space at the
  // top of every long-form post (especially deal posts where the H2
  // structure is tight and readable top-to-bottom). Killed entirely.
  //
  // We still slugify each H2's id below so anchor links from elsewhere
  // (FAQ schema, share-this-section, in-body internal links) keep
  // working — only the rendered TOC element is gone.
  (function slugifyHeadingIds() {
    var body = document.querySelector('.mvp-single-body');
    if (!body) return;
    var h2s = body.querySelectorAll(':scope > h2');
    if (!h2s.length) return;
    var slug = function (str) {
      return (str || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60);
    };
    var used = {};
    h2s.forEach(function (h2) {
      var label = (h2.textContent || '').trim();
      if (!label) return;
      var id = h2.id || slug(label);
      var base = id, i = 2;
      while (used[id]) { id = base + '-' + i; i++; }
      used[id] = true;
      h2.id = id;
    });
  })();
})();
