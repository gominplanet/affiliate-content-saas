<?php
/**
 * Reusable template helpers.
 */
if (!defined('ABSPATH')) exit;

/**
 * Author + date byline for posts.
 */
if (!function_exists('mvp_affiliate_posted_meta')) {
    function mvp_affiliate_posted_meta(): void {
        $author = mvp_affiliate_profile()['authorName'] ?? get_the_author();
        printf(
            '<div class="mvp-byline"><span class="mvp-byline-author">By %s</span><span class="mvp-byline-dot">·</span><time class="mvp-byline-date" datetime="%s">%s</time></div>',
            esc_html($author),
            esc_attr(get_the_date('c')),
            esc_html(get_the_date())
        );
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
