# HANDOFF — The Factor's Charter

**Date:** 2026-04-28
**For:** Bradley resuming with a fresh Claude session
**Status:** Working prototype, mid-iteration. Several fixes shipped in last round await user verification.

---

## How to resume

1. Upload or paste both `CLAUDE.md` and this `HANDOFF.md` into the new chat at the start.
2. Confirm Claude can access `/mnt/user-data/outputs/factors_charter.jsx`. If the file isn't there, you'll need to attach the latest copy from your Drive folder ("Factor's Charter", id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) or from the chat downloads.
3. Tell Claude what you want to do next. Reference items from the **Pending verification** or **Roadmap** sections below.

---

## Current state of features

### ✅ Working
- Title screen with Continue / Begin Anew (native `window.confirm`) / Restore from Manuscript
- 4-screen opening sequence
- Game hub with 5–6 tabs (Outpost shows only when at home)
- Trading on the In Port view with deterministic prices
- Voyaging between 4 ports with AI-generated encounters and outcomes
- Letters inbox: pre-populated Director letter + Wilbraham's papers, AI-generated subsequent letters
- First letter auto-opens after the prologue (`firstLetterPresented` flag)
- Letters accessible via Letters tab AND a persistent "Latest correspondence" card on Journal
- Map view shows trade info for visited ports (commodities, current prices, advantage tags)
- Reputation system across 6 factions
- Outpost build queue and away-log digest on return home
- Save persistence (`window.storage` + `localStorage` fallback)
- Manuscript download as timestamped JSON file (header `☰ Menu`)
- Manuscript copy-to-clipboard (header `☰ Menu`)
- Restore from pasted JSON (title screen)
- Return-to-title from in-game header menu

### ⚠️ Pending verification (last round of fixes)
These were shipped at the very end of the previous session — Bradley has not confirmed they work:

1. **SVG vignettes rendering on the title screen.** A `PinnaceVignette` was added below the "Charter" title as a litmus test. **If it shows there, all 8 loading vignettes will work.** If not, the SVG approach itself is broken in the artifact iframe and we need to pivot (likely to inline base64 PNGs).
2. **800ms minimum loading visibility.** Wraps `setPending` in `GameHub`. Should make loading vignettes actually visible during fast API responses.
3. **In Port view fitting on mobile.** Switched from media-query layout to `grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr))`. Should collapse to one column on phones regardless of iframe viewport quirks.
4. **Header `☰ Menu` showing Download/Copy/Return-to-Title.** Replaces the old marginalia-only export path.
5. **Begin Anew using native `window.confirm()`.** Replaces the inline 2-step flow that was easy to miss.

When resuming, **the very first thing to do is reload the artifact, look at the title screen, and report whether the small ship illustration is visible below the title.** That single observation tells us whether to keep building on the SVG vignette system or to pivot.

### 🐛 Known bugs / unresolved
- None confirmed open as of the end of the session. Pending verification items above are likely-fixed but unconfirmed.

---

## Things Bradley flagged that still need attention

These were noted earlier but may or may not be fully resolved:

- **AI day-passing discrepancies in non-letter contexts.** Letter responses are now correctly forced to days=0. Voyage outcome days should still pass time as designed, but verify the "X days passed" summary always matches actual state changes.
- **AI hallucinating geographically impossible scenes** (e.g., visiting characters at the wrong port). Should be fixed by the WORLD GROUNDING block in the system prompt + per-call SCENE CONSTRAINT lines, but the AI is creative — keep watching for it.
- **Saves not preserving across `makeInitialState` shape changes.** This is by design (we don't migrate saves), but worth flagging: any time you add a field to initial state, old saves will be missing it. Best practice is to wipe via "Begin a New Charter" when testing structural changes.

---

## Roadmap (Bradley's expressed interests, prioritized)

### Near-term (next session candidates)
1. **Verify the vignette pipeline end-to-end.** If working: ship more vignettes for narrative moments (encounter beats, faction-specific scenes). If broken: pivot to base64 PNGs or remove the system.
2. **NPC interaction at home.** Bradley wants to be able to tap a household member (Hodge, Dass, the Vizier) and act on their state — intervene with Hodge's drinking, respond to the Vizier's Friday audiences, etc. Currently NPC stats are tracked but not interactive.
3. **First Drive backup round-trip.** The workflow exists but is untested. Bradley exports manuscript → pastes in chat → Claude saves to Drive with timestamp. Validate the loop works.
4. **Wilbraham's teak concession hook follow-through.** It's seeded as an open thread from his papers and mentions ter Borch. Should eventually surface as an actual playable beat — a letter from ter Borch, a meeting at Port St. Eustace, or a Vizier overture.

### Mid-term
- **More variety in voyage encounters.** Currently the AI generates them but they can feel samey. Consider seeding the prompt with encounter "categories" (weather, other ships, crew issues, navigation, supernatural?) to broaden range.
- **Quotas progress visible somewhere.** The 400cwt pepper / 200cwt cinnamon target is set but the player can lose track of how close they are. Make this surface on the Ledger or as a header element.
- **End-of-charter resolution.** What happens at day 1095? Currently the game just keeps going. Needs a proper conclusion — recall in disgrace if quotas missed, glory if met, possibly with branching outcomes based on rep / wealth.
- **More buildings doing more things.** The 6 outpost buildings exist but their effects are minimal. Each should meaningfully change what's possible at home.

### Long-term / aspirational
- **Proper image generation.** Bradley asked about this. Anthropic API is text-only; current vignettes are hand-drawn SVG. If we want photorealistic period imagery, we'd need an external image-gen API (DALL-E, Stability) plumbed through. Probably overkill for the aesthetic — the engraving look fits better.
- **Multiple save slots.** Currently one save per browser. Multi-slot would let Bradley keep parallel runs.
- **Self-hosted GitHub MCP shim.** Was discussed earlier but tabled. Would let Claude commit/read from a real repo. Cloudflare Worker + PAT was the proposed path. Only if Bradley wants version control beyond the JSON manuscript export.

---

## Drive folder

**Folder:** "Factor's Charter"
**ID:** `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`
**URL:** https://drive.google.com/drive/folders/1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU

**Contains (planned):**
- `CLAUDE.md` (this session)
- `CHANGELOG.md` (this session)
- `HANDOFF.md` (this session — this document)
- Game-state backups (timestamped `.json`) when Bradley starts using the workflow

**Should be cleaned up:** Two earlier failed upload attempts (`1jggarkzjuA2lyJVJywbQIbuEEGV74Zx9` and `15jmb65ikUg52JLaiXg77sUcnD995Otm_`) — truncated factors_charter.jsx files. Bradley to delete manually.

---

## Useful diagnostic commands

For the Claude that picks this up:

```bash
# Sanity check the file parses
node -e "const p=require('/tmp/node_modules/@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('/mnt/user-data/outputs/factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"

# Find all loading messages and verify pickVignette covers them
grep -n "setPendingMsg\|Loading msg=" /mnt/user-data/outputs/factors_charter.jsx

# Check for any remaining Tailwind classes that won't apply
grep -nE "max-w-[234]xl|min-h-screen w-full" /mnt/user-data/outputs/factors_charter.jsx
```

---

## Bradley's working style (for the resuming Claude)

- Mobile, Claude app. Short responses preferred.
- Will say "do that now" when you should ship instead of discuss.
- Will say "this doesn't work" directly. Believe him.
- Values working code over architectural purity.
- Period aesthetic is sacred. Don't add anachronisms.
- Doesn't want feature creep. Solve the asked-for problem.
- Has a 140-book reading list, an Obsidian vault (Pontus, at `/Users/roti/pontus/vault/`), a trading interest, and works at The Grid in Guadalajara. Background context, not actionable.
