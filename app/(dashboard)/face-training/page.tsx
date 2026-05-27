import { redirect } from 'next/navigation'

/**
 * "Your Face" was merged into the Photobooth page (create faces + generate in
 * one place). Keep this route as a permanent redirect so old links/bookmarks
 * still land somewhere useful.
 */
export default function FaceTrainingRedirect() {
  redirect('/photobooth')
}
