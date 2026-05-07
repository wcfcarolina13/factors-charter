// Stable, deterministic 53-bit hash of a string, returned as base36 for use
// as an object key. The same input always produces the same key — used by
// the illustration cache so the same scene draws the same image, and by the
// Pollinations seed parameter so the same scene generates the same image
// across devices.
export function stableHash(s) {
  const n = (s || '').split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
  return Math.abs(n || 1).toString(36);
}

// Normalize prose for hashing and for sending as an image-generation prompt.
// Collapses whitespace, trims, and caps at 320 characters (Pollinations URL
// length limit + keeps the prompt focused). Idempotent.
export function cleanProse(prose) {
  return (prose || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}
