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

      <?php /*
        Featured-image block intentionally NOT rendered on single posts.
        The thumbnail is still stored on the WP post and shown everywhere
        else (homepage hero/featured grid, category archives, "Latest
        Reviews" grid, "Browse by Category"). Reason: every review has a
        YouTube "Watch Our Review" embed immediately below this point
        whose poster image is the same thumbnail — rendering both would
        show the same image twice in a row.
      */ ?>

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

      <?php /* ─── MOBILE-ONLY sticky "Buy" bar ────────────────────────────
            Sits fixed at the bottom of the viewport on screens < 768px so
            mobile readers always have the affiliate CTA in reach — they
            don't need to scroll back to the verdict to find one. We pull
            the first affiliate-link out of the post content (amazon /
            geni.us / amzn.to / a.co); falls back to invisible if nothing
            matches. The bar is CSS-hidden on desktop. */ ?>
      <?php
      $buy_url = mvp_affiliate_extract_affiliate_link(get_the_content());
      if ($buy_url):
      ?>
      <div class="mvp-mobile-buy-bar" role="complementary" aria-label="Buy this product">
        <a href="<?php echo esc_url($buy_url); ?>" target="_blank" rel="noopener sponsored nofollow" class="mvp-mobile-buy-btn">
          Check the price →
        </a>
      </div>
      <?php endif; ?>
    </article>

    <aside class="mvp-single-sidebar">
      <?php
      // 0. Newsletter — TOP slot. Renders before everything else when the
      //    creator picks "Top of sidebar" on the dashboard.
      echo mvp_affiliate_render_newsletter_at('sidebar', 'top');

      // 1. Pick of the Day
      echo mvp_affiliate_render_pick_of_day('sidebar');

      // 2. Render dynamic sidebar widgets (registered in functions.php)
      if (is_active_sidebar('sidebar-1')) {
          dynamic_sidebar('sidebar-1');
      }

      // 3. Render MVP Affiliate sidebar ad blocks
      $blocks = mvp_affiliate_sidebar_blocks();
      foreach ($blocks as $block) {
          echo mvp_affiliate_render_block($block);
      }

      // 4. Newsletter — BOTTOM slot (default). Renders after everything
      //    else when the creator picks "After other ads" (or hasn't
      //    chosen a slot at all). Silent no-op when newsletter is off.
      echo mvp_affiliate_render_newsletter_at('sidebar', 'bottom');
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
