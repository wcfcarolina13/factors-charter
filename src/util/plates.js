// Curated period-engraved plates served as static assets at /plates/.
// The set is small — six plates hand-matched by keyword to specific
// scene types. ImagePlate (in the JSX monolith) renders a small button
// that expands to show the matched plate inline; pickPlate scores
// plates by keyword hits in the prose, returning the best match or
// null. New plates: drop public/plates/plate-{name}.jpg, append a row
// to PLATES with its keyword set.

// In the legacy artifact runtime (`window.storage` is present), local
// asset paths don't resolve — the artifact iframe has no /plates/. Fall
// back to absolute URLs against the live PWA so the plates still load.
// In the PWA itself, `window.storage` is undefined and relative paths
// resolve against the deploy origin; CF Pages serves them with normal
// HTTP caching, and the SW runtime cache (configured in vite.config.js)
// makes second encounter instant.
const PLATE_BASE = (typeof window !== 'undefined' && window.storage)
  ? 'https://factors-charter.pages.dev/plates/'
  : '/plates/';

export const PLATES = [
  { id: 'plate-vii',  title: 'After the Squall',                  src: `${PLATE_BASE}plate-vii.jpg`,  keywords: ['squall', 'gale', 'wind shift', 'weather abated', 'kept a good offing', 'plain sight', 'rough sea', 'thanks be'] },
  { id: 'plate-viii', title: 'Prahus First Sighted',              src: `${PLATE_BASE}plate-viii.jpg`, keywords: ['prahu', 'lateen', 'bugis', 'paddl', 'sloop approach', 'paddled', 'eighteen men', 'blade at his hip'] },
  { id: 'plate-ix',   title: 'Prahus Closing — Matchlocks Primed', src: `${PLATE_BASE}plate-ix.jpg`,  keywords: ['matchlock', 'swivel', 'primed', 'beat to quarters', 'closing fast', 'engaged', 'musket shot', 'sgt. dass', 'dass cause', 'opened fire'] },
  { id: 'plate-x',    title: 'At Anchor in the Roads',            src: `${PLATE_BASE}plate-x.jpg`,    keywords: ['anchor', 'custom-house', 'custom house', 'wharf', "factor's desk", 'road afford', 'admeasurement', 'controversy at the', 'wrote at his desk'] },
  { id: 'plate-xi',   title: 'Off a Strange Island',              src: `${PLATE_BASE}plate-xi.jpg`,   keywords: ['castaway', 'idris', 'forsaken', 'smoke from the island', 'cove', 'brotherhood once used', 'pulau', 'strange island', 'oilskin cylinder'] },
  { id: 'plate-xii',  title: 'Running After a Squall',            src: `${PLATE_BASE}plate-xii.jpg`,  keywords: ['nightfall', 'sea flat and dark', 'day was lost', 'rain and river', 'helm put over', 'helm was put', 'south-south-east', "cook's coppers"] },
];

// Score plates by keyword hits in the lowercased text; return best match
// or null when no plate has any keyword hit.
export function pickPlate(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  let best = null;
  let bestCount = 0;
  for (const p of PLATES) {
    let count = 0;
    for (const kw of p.keywords) {
      if (t.includes(kw)) count++;
    }
    if (count > bestCount) { best = p; bestCount = count; }
  }
  return best;
}
