# NAEI Activity Data Scatter Chart Viewer

Interactive scatter chart visualization showing the relationship between Activity Data and pollutant emissions from the UK National Atmospheric Emissions Inventory (NAEI).

## Features

- **Single Year Analysis**: Select any year from 1970-2023
- **Activity vs Pollutant**: Compare Activity Data (x-axis) against any pollutant (y-axis)
- **Multiple Categories**: Select up to 10 emission source categories to compare
- **Color-Coded Points**: Each category displayed with a distinct color
- **High-Resolution Export**: Download charts as PNG images optimized for Twitter/social media
- **Share Functionality**: Generate shareable URLs and copy images to clipboard
- **Responsive Design**: Works on desktop and mobile devices

## Architecture

The application uses a modular JavaScript architecture with shared resources:

### Shared Resources (from `../SharedResources/`)
- `supabase-config.js` - Database connection configuration
- `analytics.js` - Privacy-friendly usage tracking
- `colors.js` - Consistent color palette management
- `common-styles.css` - Base styling shared across NAEI viewers
- `images/` - Logo, favicon, and social media icons

### Application-Specific Modules
- `index.html` - Main application structure
- `styles.css` - Scatter chart specific styling
- `data-loader.js` - Supabase data fetching and processing
- `chart-renderer.js` - Google Charts scatter chart rendering
- `export.js` - PNG export and share functionality
- `main.js` - UI coordination and event handling

## Data Source

Data is loaded from Supabase tables:
- `naei_global_t_pollutant` - Pollutant definitions and units
- `naei_global_t_category` - Emission source category definitions
- `naei_2023ds_t_category_data` - Time-series data (1970-2023)

### Activity Data

"Activity Data" is included in the NAEI dataset as a special "pollutant" that represents the underlying activity level for each emission source category (e.g., fuel consumption, vehicle-km traveled, etc.). This allows visualization of how emissions scale with activity levels.

## Usage

1. **Select Year**: Choose a single year from the dropdown
2. **Select Pollutant**: Choose the pollutant to display on the y-axis
3. **Select Categories**: Check up to 10 emission source categories to include
4. **Draw Chart**: Click "Draw Chart" to visualize the relationship
5. **Share/Export**: Use the share button to copy URL or image, or download as PNG

## URL Parameters

Share specific chart configurations using URL parameters:
```
?year=2023&pollutant_id=15&category_ids=1,38,42
```

Parameters:
- `year` - Year to display (1970-2023)
- `pollutant_id` - ID of pollutant from database
- `category_ids` - Comma-separated list of category IDs

## Browser Support

- Modern browsers with JavaScript enabled
- Google Charts library
- Clipboard API for copy-to-clipboard features (optional)

## Development

To add new features or modify the scatter chart:
1. Data operations: Edit `data-loader.js`
2. Chart rendering: Edit `chart-renderer.js`
3. Export/share features: Edit `export.js`
4. UI and coordination: Edit `main.js`
5. Styling: Edit `styles.css`

## Related Projects

- **UK Air Pollution/Emissions Line Chart** (`../linechart/`) - Time-series line chart viewer for comparing trends across years

## Credits

- Data: [UK National Atmospheric Emissions Inventory (NAEI)](https://naei.beis.gov.uk/)
- Visualization: Google Charts
- Database: Supabase
- Created by: [Chronic Illness Channel](https://www.youtube.com/@ChronicIllnessChannel)

## License

Data from NAEI is subject to their terms of use. Application code is provided for educational and research purposes.
