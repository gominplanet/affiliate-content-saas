<?php
/**
 * Comment section for single posts.
 *
 * Only ever loaded by single.php via comments_template(), and only when the
 * creator has switched comments ON in Customize Blog (layout.enableComments).
 * Spam/abuse is handled by WordPress itself: required name + email, first-time
 * comments held for moderation, and Akismet if the creator activates it.
 *
 * The newsletter opt-in checkbox inside the form is injected by the companion
 * plugin (mvpaffiliate-platform) via comment_form hooks — it appears only when
 * the creator's newsletter is enabled, and feeds the same double-opt-in list as
 * the rest of the site. Nothing here talks to the API directly.
 */
if (!defined('ABSPATH')) exit;

// Never expose comments on password-protected posts before the password is in.
if (post_password_required()) return;
?>
<section id="comments" class="mvp-comments">
  <?php if (have_comments()): ?>
    <h2 class="mvp-comments-title">
      <?php
      $count = get_comments_number();
      if ($count === '1') {
          echo 'One comment';
      } else {
          printf('%s comments', number_format_i18n($count));
      }
      ?>
    </h2>

    <ol class="mvp-comment-list">
      <?php
      wp_list_comments([
          'style'       => 'ol',
          'avatar_size' => 44,
          'short_ping'  => true,
      ]);
      ?>
    </ol>

    <?php
    // Paginate long threads.
    the_comments_navigation([
        'prev_text' => '← Older comments',
        'next_text' => 'Newer comments →',
    ]);
    ?>

    <?php if (!comments_open()): ?>
      <p class="mvp-comments-closed">Comments are closed.</p>
    <?php endif; ?>
  <?php endif; ?>

  <?php
  // The form. WordPress requires name + email (require_name_email), which is
  // exactly the "email is a required field" behaviour the request asked for.
  comment_form([
      'title_reply'         => 'Leave a comment',
      'title_reply_before'  => '<h2 class="mvp-comments-reply-title">',
      'title_reply_after'   => '</h2>',
      'class_submit'        => 'mvp-btn mvp-comment-submit',
      'label_submit'        => 'Post comment',
      'comment_notes_before' => '<p class="mvp-comment-notes">Your email is required but never published. Be kind — first-time comments are held for review.</p>',
  ]);
  ?>
</section>
