/**
 * Single source of truth for the WordPress theme + plugin versions.
 *
 * The /api/wp-version endpoint serves these to every installed copy, and
 * the theme/plugin compare their local version against them to surface a
 * native "Update available" in wp-admin.
 *
 * ───────────────────────────────────────────────────────────────────────
 * BUMPING A VERSION (do all 3 or the updater silently won't fire):
 *   1. Bump the number HERE.
 *   2. Bump the matching header in the source:
 *        - theme:  wp-plugin/mvp-affiliate-theme/style.css  (Version:)
 *                  wp-plugin/mvp-affiliate-theme/functions.php (MVP_AFFILIATE_THEME_VERSION)
 *        - plugin: wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php
 *                  (the `* Version:` header AND the MVP_AFFILIATE_VERSION define — keep them equal)
 *   3. Rebuild the zips:
 *        cd wp-plugin
 *        rm -f ../public/mvp-affiliate-theme.zip && zip -r ../public/mvp-affiliate-theme.zip mvp-affiliate-theme -x "*.DS_Store"
 *        rm -f ../public/mvp-affiliate.zip       && zip -r ../public/mvp-affiliate.zip mvpaffiliate-platform -x "*.DS_Store"
 * ───────────────────────────────────────────────────────────────────────
 */

export const WP_VERSIONS = {
  theme: {
    version: '1.4.16',
    downloadUrl: 'https://www.mvpaffiliate.io/mvp-affiliate-theme.zip',
  },
  plugin: {
    version: '1.0.40',
    downloadUrl: 'https://www.mvpaffiliate.io/mvp-affiliate.zip',
  },
} as const
