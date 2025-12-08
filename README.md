# UK Air Pollution/Emissions Data Explorer (Test)

This workspace hosts the shared v3.0 shell plus the current bubble (v2.0) and line (v2.4) chart applications for exploring UK government emissions data.

## Structure at a Glance
- `index.html` &rarr; parent shell that preloads shared data, swaps between the line and bubble chart iframes, and injects shared styles/assets.
- `SharedResources/` &rarr; common Supabase client config, analytics helper, shared-data loader, color palette, fonts, and images consumed by both charts.
- `bubblechart/` &rarr; self-contained bubble chart app with its own Supabase module (`supabase.js`), bridge loader, chart renderer, export helper, and main UI script.
- `linechart/` &rarr; modular line chart app with its own Supabase module, chart logic, and export workflow.
- `supabase/` &rarr; edge function and configuration scaffolding used by Supabase for scheduled aggregations and analytics capture.

## How Things Fit Together
1. The shell loads `SharedResources/shared-data-loader.js`, which fetches and caches pollutant, group, and timeseries tables from Supabase once per session.
2. Each iframe (bubble or line) reuses the shared cache through `SharedDataLoader`, then renders via Google Charts with its respective UI scripts.
3. User actions (filters, exports) stay inside each iframe, while high-level tab changes and analytics events are handled by the parent shell.
4. Exports rely on client-side XLSX/PNG generation; analytics events post to Supabase via `SharedResources/analytics.js` when enabled.

## Site-Wide Analytics (Optional)
- The helper `SharedResources/analytics.js` now emits an automatic `page_drawn` event (once per load) plus any manual `interaction` events you send via `SiteAnalytics.trackInteraction(label, data)`. A recurring `page_seen` heartbeat fires every 30 seconds *after* the user interacts (and only while the tab stays visible) so we approximate active dwell time instead of background tab time, and dashboard “Interactions” explicitly filters those heartbeats out so you only see deliberate actions.
- Events insert into the lightweight `site_events` table through the Supabase REST API, so no application-specific client wiring is required.
- Country attribution continues to rely on the privacy-friendly timezone/locale guess (`GB`, `US`, etc.); no IP addresses or fingerprints are stored.
- To provision the storage, run `../CIC-test-data-explorer-analytics/scripts/site_analytics_setup.sql` inside your Supabase project once (the SQL now lives in the private analytics repo), then keep the existing Row Level Security policies for the `anon` role (Supabase now maps this to the publishable key that replaces the legacy anon key).
- Per-page slugs are inferred from `body[data-page-slug]`; set `window.__SITE_ANALYTICS_DISABLE_AUTO_PAGEVIEW__ = true` before loading the script if a view should remain silent.
- For a quick local view of the data, open `../CIC-test-data-explorer-analytics/site-analytics-dashboard.html` from the private repo (serve it via `npx serve` or similar). It now pulls from `site_event_daily_summary`, `site_event_country_summary`, `site_event_session_summary`, and the latest `site_events` rows to render overview cards (including Avg Session Length), tables, and recent activity—no deployment needed.

## Working Locally
- Serve the repository with any static file server (`python -m http.server`, `npx serve`, etc.) so the Supabase client can resolve relative paths.
- Configure Supabase credentials once via `.env` + `npm run supabase:env`:
	1. Copy `.env.example` to `.env.local` (or `.env`) and drop in your test/live project values (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, optional `SUPABASE_STORAGE_KEY_BASE`). Backend/CLI scripts can also read `SUPABASE_SECRET_KEY` if you include it.
	2. Run `npm run supabase:env` (or `SUPABASE_ENV_FILE=.env.live npm run supabase:env`) to regenerate `SharedResources/supabase-env.js`. The generated file is gitignored on purpose—keep it locally (or recreate it in CI) so secrets never land in the repo.
	3. Prefer automation, but if you need to hand-edit the values, copy `SharedResources/supabase-env.template.js` to `supabase-env.js` and fill in the placeholders.
	4. The runtime `SharedResources/supabase-config.js` now auto-detects `window.__NAEI_SUPABASE_CONFIG`, so switching environments only requires rerunning the script with a different env file—no manual edits across multiple HTML files.
- Supabase functions live under `supabase/functions/` and can be deployed via the Supabase CLI when backend updates are needed.

### Supabase API Key Migration (2025+)
- Supabase now issues **publishable** (`sb_publishable_…`) keys for browser traffic and **secret** (`sb_secret_…`) keys for servers/automation. These replace the legacy `anon` and `service_role` JWTs, which Supabase will retire after November 2025.
- Generate the new keys from **Project Settings → API Keys → Try the new keys** in the Supabase dashboard, then update your `.env`/CI secrets with `SUPABASE_PUBLISHABLE_KEY` and (optionally) `SUPABASE_SECRET_KEY`.
- Re-run `npm run supabase:env` whenever you rotate the publishable key so `SharedResources/supabase-env.js` ships the latest browser-safe credential.
- CLI/Node scripts such as `scripts/export-default-data.js` automatically pick up the secret key if `SUPABASE_SECRET_KEY` or the historic `SUPABASE_SERVICE_ROLE_KEY` env vars are defined, so no additional flags are required after rotation.

## Deep-Link Tabs & Embeds
- The shell router inside `index.html` (mirrored in `404.html`) makes `/category-info`, `/user-guide`, and `/resources` deep links fall back to the SPA before the iframe content loads.
- Each tab’s copy now lives in its own folder (`/category-info/`, `/user-guide/`, `/resources/`) under `embed.html`, while the folder `index.html` simply redirects to the full shell (`/?page=…`) so direct visits keep the tab bar visible; the legacy `*-embed.html` files remain as tiny redirectors for older links and bookmarks.
- The parent iframe wrapper is responsible for sizing; the embed documents only emit height messages, so keep any structural changes self-contained inside the embed file.

### Adding Another Static Tab
1. Create `your-tab-embed.html` next to the existing embed files (reuse their boilerplate for messaging and styles).
2. Point the new tab’s iframe `src` in `index.html` to the `*-embed.html` file.
3. Copy `index.html` to `404.html` so GitHub Pages continues to serve the SPA shell for direct requests to `/your-tab`.
4. Test the new path on GitHub Pages (or a local SPA preview) by loading `/your-tab` directly to be sure the shell + iframe render together.

## Local SPA Preview
GitHub Pages hosts the test project at `/CIC-test-uk-air-pollution-emissions-data-explorer/`, so run a SPA-aware server from the parent directory to reproduce the same URL prefix locally:

```bash
cd /Users/mikehinford/Dropbox/Projects/CIC\ Data\ Explorer
npx http-server-spa ./CIC-test-uk-air-pollution-emissions-data-explorer index.html 4173 -c-1
```

- Visit `http://localhost:4173/CIC-test-uk-air-pollution-emissions-data-explorer/` for the default view, or append `/category-info`, `/user-guide`, or `/resources` to confirm deep links mount the SPA shell before loading the iframe content.
- Any SPA-aware server (`vite preview`, `serve-spa`, etc.) works as long as it rewrites unknown routes to `index.html` and preserves the `/CIC-test-uk-air-pollution-emissions-data-explorer/` prefix.

## Tailwind Build
- Run `npm install` once to pull in the Tailwind/PostCSS toolchain.
- Execute `npm run build:css` to regenerate `dist/tailwind.css` for production (GitHub Pages, Netlify, etc.).
- Use `npm run watch:css` during local development to keep the compiled stylesheet in sync.

## Version Footer Automation
- `dataexplorer-version.txt`, `linechart/linechart-version.txt`, and `bubblechart/bubblechart-version.txt` are the single sources of truth for the displayed versions.
- A pre-commit hook (`.githooks/pre-commit`) runs `scripts/update-footer-versions.js`, which refreshes the `Explorer Version … • Build …` line in any staged HTML file outside `CIC-test-Archive-Charts/`.
- Enable the hook locally once:

	```bash
	git config core.hooksPath .githooks
	```

- After editing a version file (or any footer), stage your changes and the hook will restage affected HTML files with the correct version/build string before the commit completes.

## Debugging Console Output
- Logging is suppressed by default to keep the browser console quiet.
- Append `?debug=1` (or `?logs=1`) to the URL to re-enable verbose logs across the shell and both iframes.
- Remove the flag for production-style runs; critical warnings/errors always remain visible.
