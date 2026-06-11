<?php
/**
 * Reusable template helpers.
 */
if (!defined('ABSPATH')) exit;

/**
 * Author + date byline for posts.
 *
 * 2026-06-08 (v1.4.18): added two chips next to the date — "Updated [N]"
 * (only if the post was meaningfully revised after publish, gated by a
 * 7-day window so we don't show "Updated today" on freshly-published
 * posts) and "X min read" (word-count based at 220 wpm — standard for
 * blog reading speed). Both signals are taken from Wirecutter / Tom's
 * Guide / NYT — they live next to the date so a scanner sees the
 * trust signals in the first second of the page.
 */
/**
 * Site-wide "show post dates" switch (Customize Blog → Post dates).
 * Default ON — only an explicit false from the dashboard hides dates,
 * so existing installs render exactly as before until the user opts out.
 * Covers the byline publish date, the "Updated" chip, the homepage hero
 * "Updated" line, and the Recently Published mini-dates.
 */
if (!function_exists('mvp_affiliate_show_dates')) {
    function mvp_affiliate_show_dates(): bool {
        $pm = mvp_affiliate_data()['postMeta'] ?? [];
        return !(is_array($pm) && isset($pm['showDate']) && $pm['showDate'] === false);
    }
}

if (!function_exists('mvp_affiliate_posted_meta')) {
    function mvp_affiliate_posted_meta(): void {
        $author = mvp_affiliate_profile()['authorName'] ?? get_the_author();
        $show_dates = mvp_affiliate_show_dates();

        // ── Updated chip ───────────────────────────────────────────────
        // Only show "Updated" if the post was revised more than 7 days
        // after publish. That window absorbs typical same-day edits +
        // image re-runs without bragging "Updated today" on a 6-hour-old
        // post. Beyond 7 days, the timestamp is a real freshness signal.
        $pub_ts = (int) get_the_time('U');
        $mod_ts = (int) get_the_modified_time('U');
        $is_updated = ($mod_ts - $pub_ts) > (7 * DAY_IN_SECONDS);

        // ── Read time ──────────────────────────────────────────────────
        // Word count / 220 wpm. 220 is the commonly-cited "adult reading
        // speed for non-fiction" — slow enough to feel honest, fast
        // enough that our typical 2,500-word review reads as ~11 min.
        // Floors at 2 min so a stub doesn't show "1 min read" and look
        // dismissive.
        $content = get_post_field('post_content', get_the_ID());
        $word_count = str_word_count(wp_strip_all_tags($content));
        $read_min = max(2, (int) round($word_count / 220));

        // Chips joined by dots — so hiding the date chips can never leave
        // a dangling "·" in the byline.
        $chips = [];
        $chips[] = sprintf('<span class="mvp-byline-author">By %s</span>', esc_html($author));
        if ($show_dates) {
            $chips[] = sprintf(
                '<time class="mvp-byline-date" datetime="%s">%s</time>',
                esc_attr(get_the_date('c')),
                esc_html(get_the_date())
            );
            if ($is_updated) {
                $chips[] = sprintf(
                    '<span class="mvp-byline-updated" title="Last meaningfully updated %s"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>Updated %s</span>',
                    esc_attr(get_the_modified_date()),
                    esc_html(get_the_modified_date('M j, Y'))
                );
            }
        }
        $chips[] = sprintf(
            '<span class="mvp-byline-readtime" title="Approximate read time"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>%d min read</span>',
            $read_min
        );
        echo '<div class="mvp-byline">' . implode('<span class="mvp-byline-dot">·</span>', $chips) . '</div>';
    }
}

/**
 * Inject in-content blocks at given paragraph positions.
 */
if (!function_exists('mvp_affiliate_inject_incontent')) {
    function mvp_affiliate_inject_incontent(string $content): string {
        if (!is_singular('post')) return $content;
        $blocks = mvp_affiliate_incontent_blocks();
        if (empty($blocks)) return $content;

        $by_position = [];
        foreach ($blocks as $b) {
            if (empty($b['enabled'])) continue;
            $pos = max(1, intval($b['position'] ?? 2));
            $by_position[$pos][] = $b;
        }
        if (empty($by_position)) return $content;

        $parts = preg_split('/(<\/p>)/i', $content, -1, PREG_SPLIT_DELIM_CAPTURE);
        $output = '';
        $count  = 0;
        for ($i = 0; $i < count($parts); $i++) {
            $output .= $parts[$i];
            if (isset($parts[$i]) && strtolower($parts[$i]) === '</p>') {
                $count++;
                if (isset($by_position[$count])) {
                    foreach ($by_position[$count] as $b) {
                        $output .= mvp_affiliate_render_block($b);
                    }
                }
            }
        }
        return $output;
    }
}
add_filter('the_content', 'mvp_affiliate_inject_incontent', 20);

/**
 * Category badge.
 */
if (!function_exists('mvp_affiliate_category_badge')) {
    function mvp_affiliate_category_badge(int $post_id = 0): string {
        $cats = get_the_category($post_id);
        if (empty($cats)) return '';
        $cat = $cats[0];
        return sprintf(
            '<a href="%s" class="mvp-category-badge">%s</a>',
            esc_url(get_category_link($cat->term_id)),
            esc_html($cat->name)
        );
    }
}
