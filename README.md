# UK Air Pollution/Emissions Data Explorer

This workspace hosts the shared v3.0 shell plus the current bubble (v2.0) and line (v2.4) chart applications for exploring NAEI emissions data.

## Structure at a Glance
- `index.html` &rarr; parent shell that preloads shared data, swaps between the line and bubble chart iframes, and injects shared styles/assets.
- `SharedResources/` &rarr; common Supabase client config, analytics helper, shared-data loader, color palette, fonts, and images consumed by both charts.
- `CIC-test-naei-bubblechart-v2.0/` &rarr; self-contained bubble chart app with its own Supabase module (`supabase.js`), bridge loader, chart renderer, export helper, and main UI script.
- `CIC-test-naei-linechart-v2.4/` &rarr; modular line chart app with its own Supabase module, chart logic, and export workflow.
- `supabase/` &rarr; edge function and configuration scaffolding used by Supabase for scheduled aggregations and analytics capture.

## How Things Fit Together
1. The shell loads `SharedResources/shared-data-loader.js`, which fetches and caches pollutant, group, and timeseries tables from Supabase once per session.
2. Each iframe (bubble or line) reuses the shared cache through `SharedDataLoader`, then renders via Google Charts with its respective UI scripts.
3. User actions (filters, exports) stay inside each iframe, while high-level tab changes and analytics events are handled by the parent shell.
4. Exports rely on client-side XLSX/PNG generation; analytics events post to Supabase via `SharedResources/analytics.js` when enabled.

## Working Locally
- Serve the repository with any static file server (`python -m http.server`, `npx serve`, etc.) so the Supabase client can resolve relative paths.
- Configure Supabase credentials once via `.env` + `npm run supabase:env`:
	1. Copy `.env.example` to `.env.local` (or `.env`) and drop in your test/live project values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `SUPABASE_STORAGE_KEY_BASE`).
	2. Run `npm run supabase:env` (or `SUPABASE_ENV_FILE=.env.live npm run supabase:env`) to regenerate `SharedResources/supabase-env.js`.
	3. The runtime `SharedResources/supabase-config.js` now auto-detects `window.__NAEI_SUPABASE_CONFIG`, so switching environments only requires rerunning the script with a different env file—no manual edits across multiple HTML files.
- Supabase functions live under `supabase/functions/` and can be deployed via the Supabase CLI when backend updates are needed.

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
GitHub Pages hosts the project at `/CIC-test-naei-multigroup-viewer/`, so run a SPA-aware server from the parent directory to reproduce the same URL prefix locally:

```bash
cd /Users/mikehinford/Dropbox/Projects/NAEI\ Multigroup\ Viewer
npx http-server-spa ./CIC-test-naei-multigroup-viewer index.html 4173 -c-1
```

- Visit `http://localhost:4173/CIC-test-naei-multigroup-viewer/` for the default view, or append `/category-info`, `/user-guide`, or `/resources` to confirm deep links mount the SPA shell before loading the iframe content.
- Any SPA-aware server (`vite preview`, `serve-spa`, etc.) works as long as it rewrites unknown routes to `index.html` and preserves the `/CIC-test-naei-multigroup-viewer/` prefix.

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
