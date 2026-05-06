<?php
add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('kadence-child-style', get_stylesheet_uri(), ['kadence-global'], '1.0.0');
});

// Ensure 9 categories max per page in category taxonomy
add_filter('widget_tag_cloud_args', function ($args) {
    $args['number'] = 9;
    return $args;
});
