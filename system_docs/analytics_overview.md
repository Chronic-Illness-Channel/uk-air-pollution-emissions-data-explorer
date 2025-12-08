# Site Analytics Overview

This document explains how the shared analytics helper (`SharedResources/analytics.js`) works, where the data is stored, and how to disable or debug tracking when testing locally.

## Data Flow

1. **Session + defaults**
   - Each browser session gets a generated ID stored in `sessionStorage` (`sess_<timestamp>_<random>`).
   - The helper reads `document.body.dataset.pageSlug` (or the current path) to tag every event with the active page.
   - Optional defaults can be injected via `window.__SITE_ANALYTICS_PRESET__` before the script runs.

2. **Queue + batching**
   - Events are pushed onto an in-memory queue (max 25 items).
   - A flush timer (~2 seconds) batches rows so we only hit Supabase a few times per page load.
   - Activity/heartbeat events are throttled to avoid spamming.

3. **Supabase targets**
   - Events are written to the `site_events` table.
   - Errors (only when explicitly logged) go to `site_errors` with a severity field (`warning`, `error`, `critical`).
   - Credentials/URLs come from `SharedResources/supabase-env.js`, so test vs live environments automatically point at the correct Supabase project.

4. **Event helpers**
   - `trackPageDrawn()` is invoked automatically once per iframe/page to note that the chart rendered.
   - `trackInteraction(label, payload)` is used by the chart code (bubble/line/resources) for button clicks, share actions, tutorial launches, etc.
   - Heartbeat logic periodically sends `*_page_seen` events while the tab stays active.

## Runtime Flags

Add these query parameters to the page URL when testing:

| Flag | Effect |
| ---- | ------ |
| `?analytics=off` | Disables all tracking for the current page load. The script still initializes but early-returns before enqueueing anything. |
| `?debug=1` or `?analyticsDebug=1` | Enables verbose console logging so you can see events being queued/flushed. `?logs=1` works as well. |

## Privacy/Performance Notes

- No PII is collected; only session IDs, basic browser fingerprinting, viewport info, and high-level interaction names are stored.
- The code skips analytics entirely if Supabase isn’t configured (e.g., during local file testing) to avoid console noise.
- Passive activity listeners (mouse move, scroll, touch) are throttled to 2.5s, and heartbeats stop after 60 seconds of inactivity.

## When Modifying Analytics

- Keep the table names (`site_events`, `site_errors`) in sync with `linechart/analytics_setup.sql` if schema changes are needed.
- Test with `?debug=1` to confirm events look correct before deploying.
- Remember to update BOTH environments’ Supabase projects if you add new columns or policies.
