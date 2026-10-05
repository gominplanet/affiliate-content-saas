// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The design shapes MVP keeps per product (lib/design-memory), as plain data
// that client screens and tests can import without the server-only storage code.

export const DESIGN_FORMATS = ['pin', 'ig', 'fb', 'story', 'short'] as const
export type DesignFormat = typeof DESIGN_FORMATS[number]

export const DESIGN_FORMAT_LABEL: Record<DesignFormat, string> = {
  pin: 'Pinterest pin', ig: 'Instagram post', fb: 'Facebook post', story: 'Instagram story', short: 'Shorts cover',
}

export function isDesignFormat(v: unknown): v is DesignFormat {
  return typeof v === 'string' && (DESIGN_FORMATS as readonly string[]).includes(v)
}
