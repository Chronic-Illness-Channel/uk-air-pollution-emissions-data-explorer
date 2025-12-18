# Version History

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
