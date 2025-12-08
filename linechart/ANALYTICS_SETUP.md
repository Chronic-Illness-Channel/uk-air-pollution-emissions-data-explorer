# 📊 Analytics Setup for NAEI Multi-Group Viewer

## Overview
This analytics system tracks user interactions with your NAEI viewer to help you understand:
- Which pollutants are most popular
- Which emission source groups are frequently used  
- How often data is exported (CSV/Excel/PNG)
- User engagement patterns

## Privacy-First Approach
- **No personal data collected** - only usage patterns
- **Fingerprinting is minimal** - basic browser info for unique user counting
- **All data stays in your Supabase** - no third-party analytics services
- **GDPR-friendly** - users can't be individually identified

## Setup Instructions

### 1. Create Analytics Table in Supabase

1. Open your Supabase project dashboard
2. Go to **SQL Editor**  
3. Copy and paste the contents of `analytics_setup.sql`
4. Click **Run** to create the table and views

### 2. Verify Table Creation

In the Supabase dashboard:
- Go to **Table Editor**
- You should see a new `analytics_events` table
- Check the **Database** section for the created views

### 3. Test Analytics Collection

1. Open your app (`supabase-test/index.html`)
2. Interact with it (select pollutants, change date ranges, export data)
3. Check the `analytics_events` table in Supabase - you should see new records

### 4. View Analytics Dashboard

Open `analytics-dashboard.html` in your browser to see:
- Real-time usage statistics  
- Popular pollutants and groups
- Download statistics
- Recent activity feed

## What Gets Tracked

### 📈 Page Load Events
```json
{
  "event_type": "page_load",
  "event_data": {
    "version": "v2.0-beta",
    "load_time": 1729123456789,
    "screen_resolution": "1920x1080", 
    "viewport": "1400x800"
  }
}
```

### 📊 Chart View Events  
```json
{
  "event_type": "chart_view",
  "event_data": {
    "pollutant": "PM2.5",
    "start_year": 1990,
    "end_year": 2023, 
    "groups": ["All", "Road Transport"],
    "groups_count": 2,
    "year_range": 34
  }
}
```

### ⬇️ Data Export Events
```json
{
  "event_type": "data_export", 
  "event_data": {
    "format": "csv",
    "pollutant": "NOx",
    "start_year": 2000,
    "end_year": 2020,
    "groups": ["Power Generation"],
    "filename": "NOx_2000-2020_comparison"
  }
}
```

### 🖼️ Chart Download Events
```json
{
  "event_type": "chart_download",
  "event_data": {
    "pollutant": "CO2", 
    "groups": ["All", "Industry"],
    "filename": "CO2_comparison.png"
  }
}
```

## Sample Analytics Queries

### Most Popular Pollutants
```sql
SELECT * FROM popular_pollutants 
ORDER BY views DESC 
LIMIT 10;
```

### Export Activity by Format
```sql
SELECT 
  event_data->>'format' as format,
  COUNT(*) as downloads,
  COUNT(DISTINCT session_id) as unique_users
FROM analytics_events 
WHERE event_type = 'data_export'
GROUP BY event_data->>'format';
```

### Daily Usage Trends
```sql
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as total_events,
  COUNT(DISTINCT session_id) as unique_sessions
FROM analytics_events 
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

### User Retention (returning sessions)
```sql
SELECT 
  user_fingerprint,
  COUNT(DISTINCT session_id) as sessions,
  MIN(timestamp) as first_visit,
  MAX(timestamp) as last_visit
FROM analytics_events
GROUP BY user_fingerprint
HAVING COUNT(DISTINCT session_id) > 1
ORDER BY sessions DESC;
```

## Privacy & GDPR Compliance

### What's Collected
- ✅ Browser type and version (User-Agent)
- ✅ Screen resolution and viewport size  
- ✅ Page URL and referrer
- ✅ Interaction timestamps
- ✅ Selected pollutants and groups
- ✅ Export actions and formats

### What's NOT Collected  
- ❌ IP addresses
- ❌ Names or email addresses
- ❌ Location data
- ❌ Personal identifiers
- ❌ Browsing history outside your app

### User Fingerprint
The system creates a basic fingerprint using:
- User-Agent string
- Language preference  
- Screen dimensions
- Timezone offset
- Basic canvas rendering signature

This is hashed and truncated to 16 characters for basic uniqueness while maintaining privacy.

## Troubleshooting

### No Analytics Data Appearing
1. Check browser console for errors
2. Verify Supabase connection in `analytics-dashboard.html`
3. Ensure `analytics_events` table exists and has proper permissions
4. Check that RLS policies allow inserts

### Dashboard Not Loading
1. Check that views were created successfully
2. Verify Supabase credentials in dashboard
3. Check browser console for network errors

### Performance Concerns
Analytics tracking is designed to be lightweight:
- Events are sent asynchronously
- Failed analytics don't break the app
- Minimal data payload per event
- Built-in error handling

## Data Retention

Consider setting up automatic cleanup:

```sql
-- Delete analytics older than 1 year
DELETE FROM analytics_events 
WHERE timestamp < NOW() - INTERVAL '1 year';
```

You can run this monthly via a Supabase Edge Function or cron job.