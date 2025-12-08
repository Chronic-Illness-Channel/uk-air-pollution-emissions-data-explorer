# NAEI Multi-Group Line Chart Viewer v2.4

Version 2.4 of the line chart viewer now uses **shared resources** for better code maintainability and consistency across NAEI viewer applications.

## What's New in v2.4

### Shared Resources Integration
- **Supabase Configuration**: Uses `../../Shared Resources/supabase-config.js` for database connection
- **Analytics Module**: Uses `../../Shared Resources/analytics.js` for privacy-friendly tracking
- **Color Palette**: Uses `../../Shared Resources/colors.js` for consistent color assignment
- **Common Styles**: Uses `../../Shared Resources/common-styles.css` for base styling
- **Shared Images**: Logo, favicon, and social media icons from shared directory

### Benefits
- **Consistency**: All NAEI viewers use the same color scheme and branding
- **Maintainability**: Update shared code once, affects all viewers
- **Reduced Duplication**: No duplicate code for analytics, colors, or styling
- **Easy Updates**: Change database credentials or analytics logic in one place

## File Structure

```
v2.4-shared-resources/
├── index.html              (Updated to reference shared resources)
├── supabase.js             (Simplified - uses shared config and analytics)
├── main.js                 (Simplified - uses shared colors)
├── export.js               (Unchanged)
├── styles.css              (All line chart styles, including v2.4-specific footer)
├── README_v2.4.md          (This file)
└── ... (other files unchanged)
```

## Migrating from v2.3

If you're upgrading from v2.3, the changes are:

1. **HTML**: Now includes shared CSS and JS modules
2. **supabase.js**: Removed duplicate analytics and config code
3. **main.js**: Removed duplicate color palette code
4. **images**: Now references shared image directory

## Dependencies

### Shared Resources
- `../../Shared Resources/supabase-config.js`
- `../../Shared Resources/analytics.js`
- `../../Shared Resources/colors.js`
- `../../Shared Resources/common-styles.css`
- `../../Shared Resources/images/` (logos, icons, etc.)

### External Libraries (CDN)
- XLSX.js for spreadsheet export
- Google Charts for visualization
- Supabase JS client

## Testing

To test v2.4:
1. Open `index.html` in a web browser
2. Verify the page loads and displays correctly
3. Test all functionality:
   - Select pollutant and groups
   - Draw charts
   - Export to PNG/CSV/XLSX
   - Share functionality
4. Check browser console for errors

## Backwards Compatibility

v2.3 remains unchanged and continues to work independently. v2.4 is a parallel version that demonstrates the shared resources architecture.

## Future Versions

Future updates will focus on:
- Further code modularization
- Performance improvements
- Additional chart types
- Enhanced analytics

## Related Applications

- **NAEI Activity Data Scatter Chart** (`../../CIC-test-naei-activity-data-scatterchart/`) - Also uses shared resources
- **v2.3** (original) - Standalone version with all code embedded

## Support

For issues or questions:
- GitHub: [Chronic-Illness-Channel](https://github.com/Chronic-Illness-Channel)
- YouTube: [@ChronicIllnessChannel](https://www.youtube.com/@ChronicIllnessChannel)
- Ko-fi: [Support the project](https://ko-fi.com/chronicillnesschannel)
