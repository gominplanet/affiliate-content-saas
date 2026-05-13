<?php if (!defined('ABSPATH')) exit;
get_header();
?>

<main class="mvp-main mvp-single">
  <div class="mvp-container mvp-single-layout">

    <article class="mvp-single-content">
      <?php while (have_posts()): the_post(); ?>

      <header class="mvp-single-header">
        <?php echo mvp_affiliate_category_badge(); ?>
        <h1 class="mvp-single-title"><?php the_title(); ?></h1>
        <?php if (has_excerpt()): ?>
        <p class="mvp-single-dek"><?php echo esc_html(get_the_excerpt()); ?></p>
        <?php endif; ?>
        <div class="mvp-single-meta">
          <?php mvp_affiliate_posted_meta(); ?>
        </div>
      </header>

      <?php if (has_post_thumbnail()): ?>
      <figure class="mvp-single-featured">
        <?php the_post_thumbnail('mvp-card-large', ['loading' => 'eager', 'fetchpriority' => 'high']); ?>
        <?php $caption = get_the_post_thumbnail_caption(); if ($caption): ?>
        <figcaption class="mvp-single-featured-caption"><?php echo esc_html($caption); ?></figcaption>
        <?php endif; ?>
      </figure>
      <?php endif; ?>

      <div class="mvp-single-body">
        <?php the_content(); ?>
      </div>

      <?php
      // Tags
      $tags = get_the_tags();
      if ($tags): ?>
      <div class="mvp-single-tags">
        <?php foreach ($tags as $tag): ?>
        <a href="<?php echo esc_url(get_tag_link($tag->term_id)); ?>" class="mvp-tag">#<?php echo esc_html($tag->name); ?></a>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>

      <?php endwhile; ?>
    </article>

    <aside class="mvp-single-sidebar">
      <?php
      // 1. Render dynamic sidebar widgets (registered in functions.php)
      if (is_active_sidebar('sidebar-1')) {
          dynamic_sidebar('sidebar-1');
      }

      // 2. Render MVP Affiliate sidebar ad blocks
      $blocks = mvp_affiliate_sidebar_blocks();
      foreach ($blocks as $block) {
          echo mvp_affiliate_render_block($block);
      }
      ?>
    </aside>

  </div>

  <!-- You Might Also Like -->
  <?php
  $related = new WP_Query([
      'post_type'           => 'post',
      'post_status'         => 'publish',
      'posts_per_page'      => 4,
      'orderby'             => 'rand',
      'post__not_in'        => [get_the_ID()],
      'ignore_sticky_posts' => 1,
  ]);
  if ($related->have_posts()):
  ?>
  <section class="mvp-section mvp-section-related">
    <div class="mvp-container">
      <header class="mvp-section-header">
        <h2 class="mvp-section-title">You might also like</h2>
      </header>
      <div class="mvp-grid mvp-grid-4">
        <?php while ($related->have_posts()): $related->the_post(); ?>
        <article class="mvp-card">
          <a href="<?php the_permalink(); ?>" class="mvp-card-link">
            <?php if (has_post_thumbnail()): ?>
            <div class="mvp-card-image">
              <?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?>
            </div>
            <?php endif; ?>
            <div class="mvp-card-body">
              <?php echo mvp_affiliate_category_badge(); ?>
              <h3 class="mvp-card-title"><?php the_title(); ?></h3>
            </div>
          </a>
        </article>
        <?php endwhile; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endif; ?>

</main>

<?php get_footer();
