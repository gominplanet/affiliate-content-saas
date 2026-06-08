# Thumbnail style references

Drop **3–5 `.jpg` files** here named `1.jpg`, `2.jpg`, `3.jpg`, `4.jpg`, `5.jpg`.

These are passed as input images to Nano Banana Pro on EVERY thumbnail
generation so the model matches the visual language. The system silently
no-ops on any file that doesn't exist, so you can start with 3 and add
more later — no code change needed.

## What makes a good style reference

The single best example we have is the Gemini handoff "I'M NEVER USING A
CANDLE AGAIN!" thumbnail. Look for examples that hit all of:

1. **Reviewer on one side, product hero on the other** — left/right split,
   not centered.
2. **Cinematic blue + orange (or teal + amber) lighting** — rim light
   behind the person, warm glow on the product.
3. **Bold blocky all-caps text with a thick black outline** and one
   contrasting accent colour (usually yellow on a white headline).
4. **An arrow or pointing finger** connecting text → product so the eye
   is guided.
5. **High face energy** — wide-eyed, mouth open, pointing. NOT a stiff
   smile-at-camera.

## What NOT to use

- Plain product shots (no person)
- Talking-head only (no product)
- Heavy collage / 4+ subjects
- Anything < 1280 wide

## File specs

- Format: JPEG
- Aspect ratio: 16:9 (close enough is fine)
- Width: ≥ 1280px
- File size: < 2 MB each

## How they're used

Wired up in:
- `lib/thumbnail-generators.ts` → `rehostStyleRefs()`
- `app/api/youtube/generate-thumbnail/route.ts` → injected after face + product refs

Order in the Nano Banana Pro input array:
1. Face headshot (identity lock)
2. Product photo (form lock)
3. → **Style refs (visual gestalt) — THESE FILES**

Replacing files = next generation picks them up. No build, no deploy
needed beyond the standard Vercel push.
