# Version History

## v5.0
- GH Test: 2026-01-20
- GH Live: Not yet deployed
- Notes: Added EcodesignReplacesAll view; Fireplace/Stove category selection is disabled and fixed to Fireplaces and All Stoves - All Fuels.

## v4.40
- GH Test: 2025-12-19
- GH Live: Not yet deployed
- Shared Supabase loader now uses a longer retry window (0.5s → 2.5s → 8s) and a fourth attempt to keep category-info data available during transient Supabase dropouts.

## v4.32 - LIVE
- GH Test: 2025-12-17
- GH Live: 2025-12-18
- Notes: Site errors instrumentation now mirrors Supabase console/unhandled promise messages into `site_errors` and deduplicates them to keep QA-only issues visible upstream.
- Notes: Shared Supabase loader now retries transient failures (exponential backoff + jitter) before surfacing `sbase_data_error` events on category-info embeds.

## v4.31
- GH Test: 2025-12-14
- GH Live: 2025-12-16
- Notes: Hard-refresh regression fix that isolates the bubble and line Supabase loaders (no more `supabase` redeclaration) and adds a harness scenario to guard against future collisions.

## v4.20
- GH Test: 2025-12-14
- GH Live: Not yet deployed
- Notes: Adds comparison logic to the bubble chart, enabling selectable categories and richer ratio messaging powered by the Supabase colour rules pipeline.

## v4.11
- GH Test: 2025-12-09
- GH Live: 2025-12-09
- Notes: Refined analytics by routing all share/export interactions through the lightweight tracker.

## v4.1
- GH Test: 2025-11-28
- GH Live: 2025-11-28
- Notes: Added the site-wide lightweight analytics system to the explorer.
