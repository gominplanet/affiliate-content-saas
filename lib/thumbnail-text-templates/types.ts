// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared types for the designer-grade text overlay system. Each template
// is a function that takes a `TemplateInput` and returns a `TemplateNode`
// (Satori's element tree). The orchestrator composes the result onto the
// base thumbnail image via sharp.

import type { FontFamily } from './fonts'

/** Where the headline sits relative to the subject (face/product) in the
 *  base image. The picker / face-detector chooses the safe zone; templates
 *  use it to mirror their layout. */
export type Side = 'left' | 'right'

/** Vertical anchor for the text column. 'top' is the safest default for
 *  YouTube thumbnails — face + product usually sit center/bottom of the
 *  frame, so anchoring text to the top corner avoids burying important
 *  visual content. Vision text-zone detection can override per render. */
export type VerticalAnchor = 'top' | 'center' | 'bottom'

/** Distilled content the template renders. The picker decomposes the
 *  raw headline into these parts so the template can style each part
 *  independently (different size, color, decoration). */
export interface TemplateContent {
  /** Optional small line above the main headline. Often a question or
   *  setup ("WORTH IT?", "FINALLY", "HONEST REVIEW"). */
  topLine?: string
  /** The main headline, split into a "leading" portion (white/default
   *  styling) and an emphasized "punch" portion (accent colour, larger
   *  size, or wrapped in a banner). Either can be empty. */
  leading?: string
  punch: string
  /** Optional badge / sticker in a corner of the canvas. */
  badge?: { text: string; subtext?: string; iconHint?: 'check' | 'x' | 'star' | null } | null
  /** Optional one-line subtitle BELOW the main headline. */
  subtitle?: string
}

/** Palette the template should respect. Picker derives this from the base
 *  image so the text reads well against whatever colours are behind it. */
export interface TemplatePalette {
  /** Hex. The primary text colour (usually white or near-white). */
  primary: string
  /** Hex. The accent colour applied to the `punch` text or banner. */
  accent: string
  /** Hex. The outline colour around all text (usually black). */
  outline: string
  /** Hex. Background colour for banner/pill elements when the template
   *  needs one (red banners under emphasized words, etc.). */
  bannerBg?: string
}

/** Everything a template needs to render. The orchestrator builds this. */
export interface TemplateInput {
  /** Width of the thumbnail canvas in CSS pixels. 1280 for 16:9. */
  width: number
  /** Height of the thumbnail canvas in CSS pixels. 720 for 16:9. */
  height: number
  /** Which half of the canvas the subject occupies — text goes on the OTHER side. */
  side: Side
  /** Where the text column should anchor vertically. 'top' is the default
   *  for the live flow — most YouTube thumbnails have face + product
   *  centred/lower, so anchoring text to the top corner keeps it out of
   *  the dominant subject. Templates may ignore this when their design
   *  inherently needs centred placement (e.g. mega-word). */
  verticalAnchor?: VerticalAnchor
  content: TemplateContent
  palette: TemplatePalette
}

/** Satori-compatible element tree. Templates return this. We avoid JSX
 *  syntax (no .tsx files needed) by writing tree objects directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TemplateNode = any

/** Each template module exports an object matching this shape. */
export interface Template {
  /** Stable string id used by the picker + telemetry. */
  id: string
  /** Human-readable label shown in admin UIs / logs. */
  label: string
  /** Short description used by the picker prompt — explains when this
   *  template shines so Haiku can pick wisely. */
  whenToUse: string
  /** Which fonts the template uses. The orchestrator pre-loads these
   *  via fontsFor() before invoking the template. */
  fonts: FontFamily[]
  /** Pure render function — returns a Satori element tree.
   *  No I/O, no globals. */
  render(input: TemplateInput): TemplateNode
}

/** Final picker output — orchestrator uses this to dispatch. */
export interface PickedTemplate {
  templateId: string
  content: TemplateContent
  palette: TemplatePalette
}
