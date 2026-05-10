# R2 setup — illustration corpus

One-time Cloudflare dashboard work to enable the persistent illustration cache. Same shape as the `SAVES_KV` binding you did before. After this, every (prompt, seed) pair generates exactly once across the entire player base; subsequent hits at any POP for any player serve from R2.

If you skip this, the function still works — it just regenerates on every edge-cache miss like before. The R2 layer is detected at runtime via `env.ILLUSTRATIONS` and falls through cleanly when unbound.

## Steps

1. **Create the bucket.**
   - Cloudflare dashboard → **R2 Object Storage** → **Create bucket**
   - Name: `factors-charter-illustrations`
   - Location: Automatic (default)
   - Default storage class: Standard
   - Click **Create bucket**

2. **Bind it to the Pages project.**
   - **Workers & Pages** → `factors-charter` → **Settings** → **Bindings** → **Add binding**
   - Type: **R2 bucket**
   - Variable name: `ILLUSTRATIONS` (uppercase, exactly)
   - R2 bucket: `factors-charter-illustrations`
   - Click **Save**
   - Bindings apply to subsequent function invocations — no redeploy needed.

3. **Verify.**
   ```bash
   # Cold render (first ever for this seed). Expect ~5s, x-illust-cache: miss
   SEED=$RANDOM
   URL="https://factors-charter.pages.dev/api/illustrate?prompt=a%20brigantine%20at%20anchor&seed=${SEED}"
   curl -sI "$URL" | grep -iE 'x-illust-cache|content-type'

   # Refetch from a different POP (or after edge cache eviction).
   # Expect sub-200ms TTFB, x-illust-cache: r2
   curl -s -o /dev/null -w 'TTFB: %{time_starttransfer}s\n' "$URL"
   curl -sI "$URL" | grep -i x-illust-cache
   ```

   The `x-illust-cache` response header reports which layer served the request:
   - `edge` → POP-local cache hit (fastest, ~10-50ms)
   - `r2`   → R2 hit (cross-POP, persistent; ~50-150ms)
   - `miss` → Workers AI ran (cold; ~3-6s)

## Storage layout

Keys are `flux-1-schnell/4steps/<sha256(prompt + " " + seed)>.jpg`. The model + step-count prefix means future model upgrades or step-count changes won't collide with the existing corpus — they'll start a fresh namespace and the old JPEGs can be garbage-collected at leisure (or kept indefinitely; storage is cheap).

Each object carries `customMetadata` with the source prompt (truncated to 1024 chars), seed, model name, and step count. Inspectable via the R2 dashboard or `wrangler r2 object get`.

## Capacity & cost

- R2 free tier: 10 GB storage, 1M Class A ops/month (writes), 10M Class B ops/month (reads).
- Average JPEG ~650 KB → free tier holds **~15,000 unique illustrations**.
- Reads from R2 to the Worker are zero-egress (same Cloudflare network).
- Realistic Factor's Charter scene corpus is well under 1,000 unique images — free tier indefinitely.

## Operational notes

- **Pruning isn't needed.** flux-schnell is deterministic, so the corpus converges naturally. Every retained image will be hit again the next time a player encounters that scene.
- **Migrating to a different model** (per HANDOFF #5: e.g. fall back to `@cf/stabilityai/stable-diffusion-xl-base-1.0` if Workers AI flux regresses) means changing the key prefix in `r2Key()`. Old JPEGs stay; new ones go under the new namespace. No data loss, no migration scripts.
- **Local `wrangler dev`** does not connect to remote R2 by default — the function will fall through to Workers AI on each request. Add `[[r2_buckets]]` to `wrangler.toml` with `preview_bucket_name` if you want local R2 too. Not required for production.
