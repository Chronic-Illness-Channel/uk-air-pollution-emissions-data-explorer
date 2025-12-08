# Shared Resources for NAEI Data Viewers

This directory contains shared assets and modules used by multiple NAEI data visualization applications.

## Contents

### Images (`images/`)
- `CIC - Square - Border - Words - Alpha 360x360.png` - Chronic Illness Channel logo
- `favicon.png` - Website favicon
- `Bluesky_Logo.svg` - Bluesky social media icon
- `Twitter dead bird with X.svg` - X/Twitter social media icon
- `facebook.svg` - Facebook social media icon
- `youtube-logo-6.svg` - YouTube social media icon
- `kofi_symbol.png` - Ko-fi support icon
- `kofi_symbol.svg` - Ko-fi support icon (vector)

### JavaScript Modules

#### `supabase-config.js`
Centralized Supabase database connection configuration.
- Exports: `SupabaseConfig.initSupabaseClient()`
- Used by all applications to connect to the NAEI database
- **Requires** `window.__NAEI_SUPABASE_CONFIG` to be defined *before* loading the script. Load the generated `SharedResources/supabase-env.js` (see below) or set the global manually at deployment time. The script now throws immediately if the runtime config is missing so that misconfigured environments fail fast instead of silently connecting to the wrong Supabase project.

#### `analytics.js`
Lightweight site-wide analytics helper.
- Session tracking via sessionStorage IDs (no fingerprinting)
- Auto `page_drawn` event + manual `interaction` events
- Country detection via timezone/locale (best-effort)
- Exports: `SiteAnalytics.trackInteraction()`, `SiteAnalytics.trackPageDrawn()`, legacy `Analytics.trackAnalytics()` shim

#### `colors.js`
Consistent color palette and assignment logic.
- 10-color distinct palette for data visualization
- Category-based color preferences (fireplace=red, power=green, etc.)
- Smart color assignment avoiding duplicates
- Exports: `Colors.getColorForCategory()`, `Colors.resetColorSystem()`, etc.

### Stylesheets

#### `common-styles.css`
Base styling shared across all NAEI viewers:
- Typography and layout
- Branding and logo placement
- Form controls (buttons, selects)
- Chart wrappers
- Loading overlays
- Modal/dialog styles
- Responsive design adjustments

## Usage

### In HTML
```html
<!-- Styles -->
<link rel="stylesheet" href="../SharedResources/common-styles.css">

<!-- Scripts -->
<script src="../SharedResources/supabase-env.js"></script>
<script src="../SharedResources/supabase-config.js"></script>
<script src="../SharedResources/analytics.js"></script>
<script src="../SharedResources/colors.js"></script>

<!-- Images -->
<img src="../SharedResources/images/CIC - Square - Border - Words - Alpha 360x360.png" alt="CIC Logo">
```

Load order matters: `supabase-env.js` (generated via `scripts/generate-supabase-env.js` or manually injected at deploy time) must run before `supabase-config.js` so the global `window.__NAEI_SUPABASE_CONFIG` is available. The repo now ships `supabase-env.template.js` instead of a live credential file—copy/rename it locally or recreate it in CI, but never commit the generated `supabase-env.js`. If you inject the values inline via your hosting platform, emit the snippet before `supabase-config.js` as well.

### In JavaScript
```javascript
// Optional: set a friendly slug or defaults before auto page_drawn fires
window.SiteAnalytics.configure({
   pageSlug: '/linechart',
   defaults: { app: 'linechart' }
});

// Track a user interaction
window.SiteAnalytics.trackInteraction('share_click', {
   format: 'png',
   pollutant: 'PM2.5'
});

// Get colors
const color = window.Colors.getColorForCategory('categoryName');
window.Colors.resetColorSystem(); // Reset for new chart
```

## Applications Using Shared Resources

1. **NAEI Multi-Group Line Chart Viewer** (`../CIC-test-naei-linechart-v2.4/`)
   - Time-series line charts comparing emissions across years
   - Multiple groups, flexible year range selection

2. **NAEI Activity Data Scatter Chart** (`../CIC-test-naei-scatterchart-v2.0/`)
   - Scatter plots showing activity data vs pollutant emissions
   - Single year, multiple groups (up to 10)

3. **NAEI Activity Data Bubble Chart** (`../CIC-test-naei-bubblechart-v2.0/`)
   - Bubble visualization showing pollutant vs activity with emission factor sizing
   - Single year focus with responsive comparison overlays

## Maintenance

When updating shared resources:
1. Test changes in all applications using the resources
2. Ensure backwards compatibility
3. Update this README if new resources are added
4. Document any breaking changes

## Database Schema

The shared Supabase configuration connects to these tables:
- `naei_global_t_pollutant` - Pollutant definitions and units
- `naei_global_t_category` - Emission source group definitions
- `naei_2023ds_t_category_data` - Time-series data (1970-2023)
- `site_events` - Lightweight site-wide analytics (optional)

## Color Palette

The shared color palette (from `colors.js`):
1. `#E6194B` - Red (fireplace)
2. `#3CB44B` - Green (power stations)
3. `#FFE119` - Yellow
4. `#4363D8` - Blue (gas)
5. `#F58231` - Orange (ecodesign)
6. `#911EB4` - Purple
7. `#46F0F0` - Cyan (road transport)
8. `#F032E6` - Magenta
9. `#BCF60C` - Lime
10. `#FABEBE` - Pink

Category assignments:
- Ecodesign → Orange
- Fireplace → Red
- Gas → Blue
- Power → Green
- Road → Cyan

## Analytics Events

Standard analytics events tracked across applications:
- `page_drawn` - Emitted automatically once per load when the DOM is ready
- `bubblechart_page_seen`, `linechart_page_seen`, `category_info_page_seen`, `resources_embed_page_seen`, `user_guide_page_seen` - Page-specific heartbeat emitted every 30s while the tab stays focused and there has been recent activity (explicit interaction or passive scroll/move); pauses automatically once idle for ~1 minute to approximate dwell time
- `bubblechart_seen` / `linechart_seen` - Fired once per load when each iframe-backed tab becomes visible inside the main experience and captures the active selection
- `bubblechart_drawn` / `linechart_drawn` - Fired whenever a new pollutant/category/year selection renders successfully
- `bubblechart_downloaded`, `bubblechart_data_export`, `linechart_data_export` - Capture the various export buttons; payloads include filenames, formats, and counts
- `bubblechart_share_*` / `linechart_share_*` - Family of share dialog actions (URL copy, PNG copy, email launch) prefixed by chart slug for simpler grouping
- `sbase_data_queried` / `sbase_data_loaded` / `sbase_data_error` - Supabase lifecycle events with duration + source metadata (sources now include `hero`, `shared-bootstrap`, `shared-loader`, `cache`, `direct`)

Analytics can be disabled with URL parameter: `?analytics=off`

## Credits

- Created for [Chronic Illness Channel](https://www.youtube.com/@ChronicIllnessChannel)
- Data from [UK NAEI](https://naei.beis.gov.uk/)
- Built with Supabase, Google Charts, and vanilla JavaScript
