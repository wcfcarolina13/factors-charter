# art/ — Image Catalog

Cataloged 2026-05-08. 31 ChatGPT-generated PNGs originally created for game events; many no longer map cleanly to the static, non-generative game design. One file (`file_00000000b928722f...`) was moved to Trash on cataloging as a near-duplicate of `db6c71f5...`. Current count on disk: **30**.

All hash-named files were generated in two sessions: the 1448×1086 cluster (16 files) at 16:47 UTC, the 1536×1024 cluster (15, now 14) at 16:49 UTC. The six `plate-*.jpg` files are the curated logbook plates already wired into `factors_charter.jsx` and are not catalogued here.

Filenames below are abbreviated to the first 8 hex characters of the hash (e.g. `049471f5` = `file_00000000049471f5bab223807cceae1a.png`). Use tab-completion in shell or `ls art/file_*049471f5*` to resolve.

---

## Bucket A — Drop-in ready, on-canon (12 unique scenes, 13 files)

These map to existing canonical questlines, characters, and ports. Most have logbook-plate chrome already and could go into `PLATE_*_DATA` with minimal work.

| Hash | Plate # | Scene | Maps to |
|---|---|---|---|
| `049471f5` | XIV | Factor breaks oilskin cylinder seal in counting-room, harbour with Indiaman through window | Oilskin Cylinder questline — opening reveal |
| `db6c71f5` | XIII | Factor at great-cabin desk after quitting Strange Island, cylinder beside him | Oilskin Cylinder — cabin reflection |
| `bf5c71fd` | XIX | Idris hands cylinder to captain at the binnacle by night | Oilskin Cylinder — handover at sea |
| `5ac871f5` | XXII | Factor drafts £100 bill for Chapel School; Pyke's reply names Madras boy "Cornelius" | Pyke's school subscription / Cornelius arrival |
| `ea28722f` | XVI | Boom delivers sealed packet at Eustace counting house, Dutch fleet visible | Dutch trade pass / Boom correspondence |
| `8a0871f5` | (unframed) | Vizier signs trilingual teak concession (Malay/Bugis/English), Hodge co-signs, chest of 40 rupees + crimson calico | Teak concession — Standing Arrangements |
| `dd7471f5` | XXIII | Factor passes purse to cloaked figure on Pelican's Nest waterfront | Pale Man's Sealed Letter — purse at the Nest |
| `8ddc71fd` | XVIII | Hodge at desk over cups, Factor writing it down | Wilbraham Mystery — Hodge confides indoor |
| `b2fc71f7` | XXI | Hodge weeping with bottle at godown door, Factor takes notes by lantern | Wilbraham Mystery — Hodge confides outdoor (alternate to XVIII) |
| `76dc71f5` | XXII* | Pilot from Fort Marlborough comes aboard at dawn | Fort Marlborough first arrival (*renumber — XXII collides with `5ac871f5`) |
| `618c71fd` | (unframed) | Vizier hands sealed letter for Dutch Resident, tea untouched | Vizier covert errand to Kota Pinang Dutch |
| `c75c71f5` | XX | Factor seals packet for Capt. Whitcombe, turbaned servant nearby | Whitcombe / HMS Adventure correspondence |
| `4cd871f5` + `4ef471f5` | (unframed) | Pair: vendor points to "Rumah Biru" lodgings (4ef471f5) → landlady there describes thin scarred caller (4cd871f5) | Wilbraham Mystery — Rumah Biru investigation pair |

**Decision needed:** for the Hodge confession beat (`8ddc71fd` vs `b2fc71f7`), pick one as the canonical Wilbraham scene; the other can serve a different Hodge moment or be archived.

---

## Bucket B — Generic atmospheric, high reuse (3)

No questline-specific characters or captions. Good fits for `genVoyageEncounter` fallbacks or `InlineIllustration` content cache.

| Hash | Plate # | Scene |
|---|---|---|
| `b0b4720c` | VII | Crewmen ride out clearing squall on small ship's deck at dusk |
| `e468720c` | XII | Pinnace runs SSE before a squall at dusk |
| `f5f871f7` | (no chrome) | Crew repels proa boarding attempt; cinnamon crate spilled on deck |

`f5f871f7` is the only PNG in the set without logbook chrome — would need a frame added or use full-bleed in a different context.

---

## Bucket C — Caption surgery needed (4)

Functional images with real-world place names that violate the WORLD_NOTES transposition rule (no Hawaii, no real Malacca/Bantam in caption).

| Hash | Plate # | Issue | Fix |
|---|---|---|---|
| `22ec722f` | VIII | Caption: "off the Southwestward of Owhyhee" | Drop locator or rename to e.g. "off Tanjung Cermin" |
| `62dc720c` | IX | Caption: "off the Southward of Owhyhee", names Sgt. Dass | Same; preserves Dass — keep |
| `bb94722f` | X | Caption: "before sailing for Port Malacca", BANTAM crate | Kota Pinang; relabel crate as PEPPER or PIPER NIGRUM |
| `3224720c` | XV | BANTAM pepper crate; Faulke retainer payment scene | Same crate fix |

Caption fixes are caption-only — the imagery is fine. Could be patched in `gimp`/`inkscape` or just regenerated with corrected prompts.

---

## Bucket D — Introduces non-canonical names (3)

Three images depict a Bugis lascar named "Idris" (and one names "Subhan"). These names do not exist in current `factors_charter.jsx` canon. Either canonize Idris as a recurring crew character (cheapest — gains 3 plates including `bf5c71fd`) or relabel.

| Hash | Plate # | Scene | Issue |
|---|---|---|---|
| `1068722f` | XI | Factor + Idris watch smoke rise from forsaken jungle island | Names Idris |
| `dd6871f5` | XVII | Idris signals a passing proa from the rail | Names Idris |
| `708071f5` | (unframed) | Bugis trade pact with elder, "Subhan", Hollander witness | Names Subhan, references unnamed Bugis family |

(`bf5c71fd` in Bucket A is the third Idris plate — its placement there assumes Idris becomes canon.)

---

## Bucket E — Generic interiors, weaker fit (5)

Plausible scenes but no clear questline match. Some have label issues.

| Hash | Plate # | Scene | Note |
|---|---|---|---|
| `13c0722f` | (unframed) | Counting room with Asian boy + older shopkeeper, cinnamon jars | Generic; possible apprentice intro |
| `58ac71fd` | (unframed) | Chinese merchant + Factor over manifest, "Jansen & Co." | Names "Jansen & Co." — relabel or discard |
| `b4d071fd` | (unframed) | Schoolmaster shows pupil roster to Factor | Pairs with `5ac871f5` (Pyke's school) — possible companion piece |
| `b94c722f` | (unframed) | Articles of agreement with boy + shopkeeper, cinnamon jars | Possible plantation contract scene |
| `719c71f5` | (unframed) | Factor interviews boy with ledger, sentry through window; ledger note: "Brass buckle left — copper buckle right" | Investigative beat — could fit Wilbraham Mystery as a clue scene |

---

## Bucket F — Specific tone, no current questline match (1)

| Hash | Plate # | Scene | Note |
|---|---|---|---|
| `1f7871f5` | (unframed) | Factor presses Malay woman against "Toko Rempah" spice stall, sampans behind | Strong Brotherhood-whisper / contraband-tip tone; no current canonical scene matches. Candidate for a new minor scripted arrival, or archive |

---

## Sequence/pair use

Some images naturally read as paired panels rather than alternates:

- **Oilskin Cylinder triptych:** `bf5c71fd` (handover at binnacle) → `db6c71f5` (cabin reflection) → `049471f5` (counting-room reveal at Bayan-Kor)
- **Wilbraham Mystery Rumah Biru pair:** `4ef471f5` (vendor points the way) → `4cd871f5` (landlady describes the caller)
- **Hodge confession alternates:** `8ddc71fd` (indoor cups) ↔ `b2fc71f7` (godown door at night) — pick one for the Wilbraham scene

---

## Open decisions for the user

1. **Canonize Idris?** Three plates depend on this. Gains: cheap rescue of `1068722f`, `dd6871f5`, `bf5c71fd`. Cost: a small WORLD_NOTES entry and possibly a runtime crew-roster line.
2. **Hodge confession — `8ddc71fd` or `b2fc71f7`?** Both are strong; only one fits the canonical Wilbraham scripted beat.
3. **Caption-fix vs regenerate** for the four "Owhyhee/Malacca/Bantam" plates — does the project have an image-editing path, or just regenerate from corrected prompts?
4. **Bucket E + F** — keep as a creative reservoir or trim?
