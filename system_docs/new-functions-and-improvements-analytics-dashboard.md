# New Functions and Improvements

This note captures potential enhancements for the analytics + dashboard stack, along with high-level implementation sketches for alerting and reporting.

## Code Improvements

1. **Unify shared helpers**
   - Move heartbeat label manifests, interaction metric lists, and time-bucket builders into a small shared module that both the dashboard and chart runtimes import. This avoids duplicate label lists (for example, the Interaction Trend dropdown) and keeps future label additions consistent.
   - Extract the bucket-alignment logic (half-hour/hour/day bins) into a reusable helper so other reports can reuse it without porting the math.

2. **Pre-bucketed analytics endpoint**
   - Add a Supabase RPC or REST endpoint that returns aggregated interaction metrics per bucket for a timeframe. The dashboard could then request the pre-computed series instead of downloading raw events for the short ranges, keeping the UI responsive as traffic grows.

3. **Automated validation**
   - Add lightweight tests or lintable helper files (for example, via Vitest or Jest) covering bucket alignment, heartbeat eligibility, and label normalization. This prevents regressions as interaction labels and range logic expand.

## Email Summaries & Alerts

Client-side code cannot send email directly, so we need a server-side job or edge function that queries Supabase and triggers an external email service.

### Daily Digest

- **Data source**: `site_events` and `site_errors` tables.
- **Implementation**:
  1. Create a Supabase Edge Function (or other backend job) that runs on a schedule (Supabase scheduled functions, GitHub Actions cron, or a small Node script on Fly.io/Render).
  2. Aggregate interaction/event counts per `event_label`, plus error counts grouped by severity. Include trend comparisons (e.g., vs previous day) if desired.
  3. Send the formatted summary via an email API (Resend, SendGrid, SES, etc.). Store API credentials on the backend only.
- **Output**: one email per day summarizing total sessions, top interactions, and error breakdowns.

### Real-time / Critical Error Alerts

- **Trigger**: new rows in `site_errors` with `severity` >= `error` (or `critical`).
- **Implementation options**:
  1. Database trigger inserts qualifying rows into a lightweight `site_alerts` table. An Edge Function subscribes via Supabase Realtime and sends an email immediately when a row arrives.
  2. Scheduled worker polls `site_errors` every few minutes for unseen rows and emails a batch of critical events.
- **Email content**: page slug, source (`bubble-supabase`, `linechart-supabase`, `shared-data-loader`), message, duration, and any extra metadata (pollutant/category IDs) already included in `details`.

Both approaches rely on backend services because browsers cannot safely hold email credentials. The current analytics events already contain the metadata needed for useful summaries, so once the backend job is in place the dashboard data doubles as the alerting source.
