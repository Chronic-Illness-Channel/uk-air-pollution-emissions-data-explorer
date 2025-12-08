# Site Errors Reference

A dedicated `site_errors` table captures detailed failure context for the live data explorer surfaces. Every high-level error that still gets summarized in `site_events` (for example `sbase_data_error`) **also** emits one or more rich rows here so we can debug without polluting the interaction stream.

## Schema Overview

| column | type | notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key. |
| `error_timestamp` | `timestamptz` | Client-reported failure time (falls back to insert time if missing). |
| `recorded_at` | `timestamptz` | Server insert time (`DEFAULT now()`). |
| `session_id` | `text` | Mirrors the lightweight analytics session when available. Helpful for joining back to `site_events`. |
| `page_slug` | `text` | Normalized path (e.g. `/bubblechart`, `/linechart`). |
| `page_url` | `text` | Full URL where the failure occurred. |
| `source` | `text` | Component identifier (`bubble-supabase`, `hero-dataset`, `linechart-supabase`, `shared-data-loader`, etc.). |
| `severity` | `text` | One of `warning`, `error`, `critical`. Defaults to `error`. |
| `error_code` | `text` | Optional machine-friendly code (`42501`, `FetchError`, etc.). |
| `message` | `text` | Human-readable summary. |
| `details` | `jsonb` | Structured payload (dataset source, durations, stack traces, query metadata, etc.). |

Key indexes: `recorded_at DESC`, `error_timestamp DESC`, `page_slug`, `severity`, `source`, and `session_id` (partial). RLS mirrors `site_events`: anon/auth clients can insert; only authenticated + service roles can select full rows (dashboards can use the optional `site_error_summary` view if they need sanitized data).

## Current Producers

| Source | What gets logged | Severity | Detail payload |
| --- | --- | --- | --- |
| `bubble-supabase` (and stage-specific labels such as `hero-dataset`, `shared-loader`, `snapshot-helper`) | Any failure while hydrating the scatter/bubble dataset (shared loader bootstrap, direct Supabase fetches, selector metadata). | `error` unless explicitly downgraded. | Dataset source (`cache`, `shared-loader`, `direct`, etc.), query metadata (did the request use URL overrides / snapshot?), render duration, plus the JS stack. |
| `linechart-supabase` | Same as above but for the multiseries line chart module. | `error` | Includes whether the snapshot path was eligible, shared loader availability, dataset source, durations, and stack traces. |
| `shared-data-loader` | SharedResources loader failures that occur before either chart module runs (bootstrap dataset fetches, hero dataset fallbacks, etc.). | `error` | Captures the label of the failing stage, retry counts, duration, and stack so we can debug loader-level regressions independent of a specific chart. |

Other modules should follow the same pattern: emit a concise `sbase_data_error` row to `site_events`, then immediately call `window.SiteErrors.log({...})` with the richer context so tooling can diagnose regressions.

## Detail Payload Shape

`details` is free-form JSON, but we keep a few conventions so dashboards/alerts can parse them:

- `datasetSource`: `cache`, `shared-loader`, `hero`, `direct`, `snapshot`, etc.
- `durationMs`: elapsed milliseconds for the failing code path.
- `query`: mirrors whatever metadata we passed to the matching `sbase_data_queried` event (URL override flags, snapshot eligibility, shared-loader availability, timestamps).
- `stack`: JavaScript stack trace when available.
- `extra`: module-specific context (e.g., selected pollutant/category IDs) when it helps debugging.

## Usage Notes

1. **Always log both**: keep sending `sbase_data_error` to `site_events` for lightweight counts, and follow it up with a `site_errors` insert for the deep dive payload.
2. **Timestamps**: pass through the original `queryDetails.timestamp` (client clock) as `error_timestamp` so it aligns with the matching analytics rows. Supabase still stamps `recorded_at` for server ordering.
3. **Severity**: default to `error`. Use `warning` for known transient states (e.g., clipboard unsupported) and `critical` if we plan to page on it.
4. **Access**: only authenticated/service roles can read the raw table. Client dashboards should query `site_error_summary` if they need counts without exposing stack traces.

## Example Query

```sql
SELECT
  DATE_TRUNC('hour', recorded_at) AS logged_hour,
  source,
  severity,
  COUNT(*) AS total,
  COUNT(DISTINCT session_id) AS affected_sessions
FROM site_errors
WHERE recorded_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3
ORDER BY logged_hour DESC;
```

Use the `session_id` + `page_slug` pair to join `site_errors` back to `site_events` when you want to see what the user attempted right before the failure.
