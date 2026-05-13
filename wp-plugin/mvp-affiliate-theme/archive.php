<?php if (!defined('ABSPATH')) exit;
get_header();
?>
<main class="mvp-main mvp-archive">
  <div class="mvp-container">
    <header class="mvp-archive-header">
      <?php if (is_category() || is_tag() || is_tax()) {
          single_term_title('<p class="mvp-archive-eyebrow">Category</p><h1 class="mvp-archive-title">', '</h1>');
          $desc = term_description();
          if ($desc) echo '<div class="mvp-archive-description">' . $desc . '</div>';
      } elseif (is_author()) {
          ?>
          <p class="mvp-archive-eyebrow">Author</p>
          <h1 class="mvp-archive-title"><?php the_author(); ?></h1>
          <?php
      } else {
          the_archive_title('<h1 class="mvp-archive-title">', '</h1>');
      } ?>
    </header>

    <?php if (have_posts()): ?>
    <div class="mvp-grid mvp-grid-3">
      <?php while (have_posts()): the_post(); ?>
      <article class="mvp-card">
        <a href="<?php the_permalink(); ?>" class="mvp-card-link">
          <?php if (has_post_thumbnail()): ?>
          <div class="mvp-card-image"><?php the_post_thumbnail('mvp-card', ['loading' => 'lazy']); ?></div>
          <?php endif; ?>
          <div class="mvp-card-body">
            <?php echo mvp_affiliate_category_badge(); ?>
            <h2 class="mvp-card-title"><?php the_title(); ?></h2>
            <div class="mvp-card-meta"><?php mvp_affiliate_posted_meta(); ?></div>
          </div>
        </a>
      </article>
      <?php endwhile; ?>
    </div>

    <nav class="mvp-pagination"><?php the_posts_pagination(['prev_text' => '← Previous', 'next_text' => 'Next →']); ?></nav>
    <?php else: ?>
    <p class="mvp-empty">No posts in this category yet.</p>
    <?php endif; ?>
  </div>
</main>
<?php get_footer();
