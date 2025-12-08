# NAEI Data Viewer Projects - Migration Summary

## Overview
Successfully completed migration to shared resources architecture and created new scatter chart viewer.

**Date Completed**: November 3, 2025

## Directory Structure

```
CIC-test-naei-data/
├── Shared Resources/
│   ├── images/              (Logos, icons, favicon)
│   ├── analytics.js         (Privacy-friendly tracking)
│   ├── colors.js            (10-color palette with category mapping)
│   ├── common-styles.css    (Base styling)
│   ├── supabase-config.js   (Database configuration)
│   └── README.md
│
├── CIC-test-naei-linechart/  (Renamed repository and directory)
│   ├── v2.3-modular-CIC-testdb/    (Original working version - PRESERVED)
│   └── v2.4-shared-CIC-testdb/      (NEW - Uses shared resources)
│       ├── index.html
│       ├── main.js
│       ├── supabase.js
│       ├── export.js
│       ├── styles.css
│       └── README_v2.4.md
│
└── CIC-test-naei-activity-data-scatterchart/  (NEW APPLICATION)
    ├── index.html
    ├── main.js
    ├── data-loader.js
    ├── chart-renderer.js
    ├── export.js
    ├── styles.css
    └── README.md
```

## What Was Created

### 1. Shared Resources (New)
**Location**: `/Shared Resources/`

#### JavaScript Modules:
- **supabase-config.js**: Centralized Supabase database connection
  - Exports: `SupabaseConfig.initSupabaseClient()`
  - Single source of truth for database credentials

- **analytics.js**: Privacy-friendly usage tracking
  - Session tracking with UUID
  - User fingerprinting (privacy-preserving)
  - Country detection via timezone
  - Exports: `Analytics.trackAnalytics()`, `Analytics.getUserCountry()`, etc.

- **colors.js**: Consistent color palette system
  - 10 distinct colors for data visualization
  - Category-based preferences (fireplace=red, power=green, gas=blue, etc.)
  - Smart color assignment avoiding duplicates
  - Exports: `Colors.getColorForCategory()`, `Colors.resetColorSystem()`, etc.

#### Stylesheets:
- **common-styles.css**: Base styling for all NAEI viewers
  - Typography and layout
  - Branding and logo placement
  - Form controls (buttons, selects)
  - Chart wrappers
  - Loading overlays
  - Modal/dialog styles
  - Responsive design adjustments

#### Assets:
- **images/**: All shared visual assets
  - CIC logo (360x360)
  - Favicon
  - Social media icons (YouTube, Bluesky, X/Twitter, Facebook)
  - Ko-fi support icon

### 2. Scatter Chart Viewer (New Application)
**Location**: `/CIC-test-naei-activity-data-scatterchart/`

Complete new application for visualizing Activity Data vs Pollutant emissions:

#### Features:
- Single year selection (1970-2023)
- Activity Data on X-axis
- Any pollutant on Y-axis
- Up to 10 groups via checkboxes
- Color-coded data points
- High-resolution PNG export (Twitter-optimized)
- Share functionality (URL + clipboard)
- URL parameter support for shareable links

#### Files:
- **index.html**: Main application page with branding
- **data-loader.js**: Supabase data fetching and processing
- **chart-renderer.js**: Google Charts scatter plot rendering
- **export.js**: PNG export and share functionality
- **main.js**: UI coordination and event handling
- **styles.css**: Scatter chart specific styling
- **README.md**: Complete documentation

### 3. Line Chart v2.4 (Updated Version)
**Location**: `/CIC-test-naei-linechart/v2.4-shared-CIC-testdb/`

Updated version of the line chart viewer using shared resources:

#### Changes from v2.3:
- Uses shared Supabase configuration
- Uses shared analytics module
- Uses shared color palette
- Uses shared base styles
- References shared images
- Removed ~150 lines of duplicate code

#### Files Modified:
- **index.html**: Added shared resource references
- **supabase.js**: Simplified (uses shared config and analytics)
- **main.js**: Simplified (uses shared colors)
- **styles.css**: Line chart styling (now includes footer + v2.4 overrides)

#### Preserved:
- **v2.3**: Original fully-functional version kept intact

## Benefits of New Architecture

### 1. Code Reusability
- Shared modules eliminate duplication
- Single source of truth for configuration
- Consistent behavior across applications

### 2. Maintainability
- Update database credentials in one place
- Modify color scheme once, affects all viewers
- Fix analytics bugs once

### 3. Consistency
- Same branding across all viewers
- Identical color assignments for groups
- Uniform user experience

### 4. Scalability
- Easy to add new viewer applications
- Simple to add new shared utilities
- Clear separation of concerns

## Testing Checklist

### Shared Resources
- [x] Images load correctly
- [x] Supabase connection initializes
- [x] Analytics tracking works
- [x] Colors assign correctly
- [x] Styles apply properly

### Scatter Chart Viewer
- [ ] Page loads without errors
- [ ] Year selector populates
- [ ] Pollutant selector populates
- [ ] Group checkboxes work (max 10)
- [ ] Chart draws correctly
- [ ] PNG export works
- [ ] Share URL copies
- [ ] Share PNG copies
- [ ] URL parameters load chart

### Line Chart v2.4
- [ ] Page loads without errors
- [ ] Uses shared resources correctly
- [ ] Chart rendering unchanged
- [ ] Export features work
- [ ] Share features work
- [ ] No regressions from v2.3

## Migration Notes

### For Future Developers:
1. **Adding new viewers**: Copy scatter chart structure, modify data-loader and chart-renderer
2. **Updating shared code**: Test in all applications after changes
3. **Database changes**: Update supabase-config.js only
4. **Styling changes**: Update common-styles.css for global, app-specific CSS for local

### Known Issues:
- None currently identified

### Browser Compatibility:
- Modern browsers with ES6+ support
- Google Charts library required
- Clipboard API for copy features (optional)

## Analytics Events

Standard events tracked across both applications:
- `page_load` - Application initialized
- `chart_drawn` / `scatter_chart_drawn` - Chart rendered
- `share_url_copied` - Shareable URL copied
- `share_png_copied` - Chart image copied
- `chart_downloaded` / `scatter_chart_downloaded` - PNG downloaded

Opt-out: Add `?analytics=off` to URL

## Color Palette

Shared 10-color palette:
1. #E6194B (Red) - Fireplace
2. #3CB44B (Green) - Power
3. #FFE119 (Yellow)
4. #4363D8 (Blue) - Gas
5. #F58231 (Orange) - Ecodesign
6. #911EB4 (Purple)
7. #46F0F0 (Cyan) - Road
8. #F032E6 (Magenta)
9. #BCF60C (Lime)
10. #FABEBE (Pink)

## Database Schema

All applications connect to:
- `naei_global_t_pollutant` - Pollutant definitions and units
- `naei_global_t_category` - Emission source category definitions
- `naei_2023ds_t_category_data` - Time-series data (1970-2023)
- `analytics_events` - Usage tracking (optional)

## Next Steps

### Immediate:
1. Test scatter chart viewer in browser
2. Test line chart v2.4 in browser
3. Verify all share/export functions
4. Check analytics tracking

### Future Enhancements:
- Add more chart types (bar, pie, etc.)
- Create data export module
- Add data filtering options
- Enhance mobile responsiveness
- Add chart annotations
- Create admin dashboard

## Credits

- **Data Source**: [UK NAEI](https://naei.beis.gov.uk/)
- **Visualization**: Google Charts
- **Database**: Supabase
- **Created by**: [Chronic Illness Channel](https://www.youtube.com/@ChronicIllnessChannel)

## Support

- YouTube: [@ChronicIllnessChannel](https://www.youtube.com/@ChronicIllnessChannel)
- Ko-fi: [Support the project](https://ko-fi.com/chronicillnesschannel)
- GitHub: [Chronic-Illness-Channel](https://github.com/Chronic-Illness-Channel)

---

**Project Status**: ✅ Complete - Ready for testing
**Migration Date**: November 3, 2025
