# Site Events Reference

This document captures every `page_slug`/`event_type`/`event_label` combination that can be written to `site_events` by the live (non-archive) code inside this repository as of 5 December 2025. All events flow through `SharedResources/analytics.js`, so rows share a consistent schema and batching behavior.

## Global Signals (all pages that load `SharedResources/analytics.js`)

| page_slug examples | event_type | event_label | When it fires | Notes |
| --- | --- | --- | --- | --- |
| `/home`, `/bubblechart`, `/linechart`, `/category-info`, `/resources-embed`, `/user-guide`, dev test pages | `system` | `page_drawn` | Exactly once per load, when DOM is ready | Includes viewport + screen metadata; automatic unless `window.__SITE_ANALYTICS_DISABLE_AUTO_PAGEVIEW__` is set. |

Heartbeat pings now use slug-specific labels (for example `bubblechart_page_seen`, `linechart_page_seen`, `category_info_page_seen`) rather than the generic `page_seen`. See the sections below for each slug’s label.

## `/bubblechart`

| event_type | event_label | Trigger | Key metadata |
| --- | --- | --- | --- |
| `interaction` | `bubblechart_seen` | First time the iframe (or standalone page) becomes visible (`bubblechart/index.html`) | `pageSlug` forced to `/bubblechart`; payload mirrors the share URL (pollutant, category IDs + flags, year) so this is the canonical “chart view” signal (only `page_seen` heartbeats remain excluded). |
| `interaction` | `bubblechart_page_seen` | Every 30s heartbeat after the user interacts and while the bubble chart tab stays visible | Carries dwell seconds, heartbeat interval, and heartbeat count; dashboards can filter it out when only deliberate actions are needed. |
| `system` | `sbase_data_queried` | Supabase query/snapshot race begins in `bubblechart/supabase.js` | Records whether URL overrides were present, snapshot eligibility, and timestamp. |
| `system` | `sbase_data_loaded` | Supabase-backed dataset load succeeds (hero, cache reuse, or full fetch) | Includes precise data source (`hero`, `shared-bootstrap`, `shared-loader`, `cache`, `direct`), the new `loadMode` field (`hero`, `full-bootstrap`, `full-shared-loader`, `full-cache`, `full-direct`), duration, row count, and the `fullDataset` flag. |
| `system` | `json_data_loaded` | A bundled JSON snapshot hydrates the chart (default render or inactive-chart mode) | Captures snapshot duration, generation timestamp, row/pollutant/category counts, and the `page` identifier so we can monitor offline-only loads. |
| `system` | `sbase_data_error` | Dataset load throws | Captures error message + source + duration for debugging fetch failures. |
| `system` | `bubblechart_drawn` | User commits a *new* combo of year/pollutant/categories (`bubblechart/main.js`) | Deduped via JSON selection key; payload lists pollutant name, category IDs, and counts. |
| `interaction` | `bubblechart_downloaded` | PNG export button succeeds (`bubblechart/export.js`) | Emits year, pollutant, category count, filename, and `chart_type`. |
| `interaction` | `bubblechart_share_url_copied` | URL copy button inside share dialog | Tracks pollutant, year, category count, plus the resolved share URL for debugging mismatches. |
| `interaction` | `bubblechart_share_png_copied` | “Copy chart image” button completes | Same context as above plus clipboard success/failure. |
| `interaction` | `bubblechart_share_email_opened` | Email helper copies the chart image + opens mail client | Includes share URL + selection metadata so high-intent shares can be grouped with exports. |
| `interaction` | `bubblechart_data_export` | CSV/XLSX data export runs (`bubblechart/export.js`) | Includes format, pollutant, year, and category count for downstream aggregation. |

_Note:_ `bubblechart/main.js` explicitly calls `trackAnalytics('page_drawn', {app: 'bubble_chart'})` after the UI reveals; this enriches the automatic `page_drawn` event but does not introduce a new tuple.

## `/linechart`

| event_type | event_label | Trigger | Key metadata |
| --- | --- | --- | --- |
| `interaction` | `linechart_seen` | iframe/page becomes visible (`linechart/index.html`) | Mirrors the bubble logic and includes the active pollutant, category list, and year range so it can double as the official chart view/selection log (only `page_seen` heartbeats are ignored). |
| `interaction` | `linechart_page_seen` | Every 30s heartbeat after the user interacts and while the line chart tab stays visible | Includes dwell seconds, heartbeat interval, and heartbeat count; filter out if you need only explicit actions. |
| `system` | `sbase_data_queried` | Line shared-loader kicks off (`linechart/supabase.js`) | Tracks overrides, snapshot eligibility, shared loader availability. |
| `system` | `sbase_data_loaded` | Supabase-backed dataset load succeeds (hero, cache reuse, or full fetch) | Emits source (`hero`, `shared-bootstrap`, `shared-loader`, `cache`, `direct`), `loadMode` (hero/full variants incl. `full-cache`), duration, row count, and the `fullDataset` flag. |
| `system` | `json_data_loaded` | The default JSON snapshot hydrates the chart before Supabase wins | Includes snapshot generation timestamp, duration, and row/pollutant/category counts for offline/inactive renders. |
| `system` | `sbase_data_error` | Dataset load fails | Error message + source + duration. |
| `system` | `linechart_drawn` | New selection of pollutant, categories, or year range is rendered (`linechart/main.js`) | Includes year span, category count, and pollutant identifier. |
| `interaction` | `linechart_share_button_click` | Share dialog opened (`linechart/export.js`) | Payload carries pollutant, category count, and year span. |
| `interaction` | `linechart_share_url_copied` | Share dialog URL copied | Indicates successful link copy, with the same context metadata + share URL. |
| `interaction` | `linechart_share_png_copied` | Chart PNG copied to clipboard from share dialog | Signals more engaged share action. |
| `interaction` | `linechart_share_email_opened` | Email workflow launched | Logs pollutant/category context, share URL, and whether a year range was chosen. |
| `interaction` | `linechart_data_export` | Time-series CSV/XLSX exported | Records format, pollutant, category list, year range, and filename base. |

## Other live slugs

Pages like `/category-info`, `/resources-embed`, and `/user-guide` only load `SharedResources/analytics.js` without additional manual calls. They therefore emit the global `page_drawn` plus their own slug-specific heartbeat events:

| page_slug | event_label |
| --- | --- |
| `/category-info` | `category_info_page_seen` |
| `/resources-embed` | `resources_embed_page_seen` |
| `/user-guide` | `user_guide_page_seen` |

Each heartbeat fires every 30 seconds after user activity while the tab stays visible, carrying the same dwell/interval/count metadata described above.

The homepage ( `/` ) currently emits only the automatic `page_drawn` system event because it is not included in the heartbeat label map inside `SharedResources/analytics.js`.

If new interactions are added, prefer routing them through `window.SiteAnalytics.trackInteraction(label, meta)` so these tables remain accurate and the dashboard continues to group events consistently. The only embed-specific slug today is `resources-embed` (that module runs inside other pages), whereas `category-info` and `user-guide` load as full standalone views, so their slugs don’t need extra suffixes.
