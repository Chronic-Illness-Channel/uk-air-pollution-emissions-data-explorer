-- Daily Analytics Aggregation Script
-- Run this at 4am daily to populate the daily_analytics table
-- Can be used in Supabase Edge Functions, cron job, or manual execution

-- Insert or update daily statistics for yesterday (4am boundary)
INSERT INTO daily_analytics (
    date,
    total_sessions,
    unique_users,
    linechart_drawn,
    data_exports,
    chart_downloads,
    ui_interactions,
    how_to_use_opens,
    group_info_opens,
    smoothing_toggles,
    countries,
    popular_pollutants,
    popular_groups
)
SELECT 
    stats_date,
    total_sessions,
    unique_users,
    linechart_drawn,
    data_exports,
    chart_downloads,
    ui_interactions,
    how_to_use_opens,
    group_info_opens,
    smoothing_toggles,
    countries,
    -- Aggregate popular pollutants for the day
    (
        SELECT jsonb_object_agg(pollutant, view_count)
        FROM (
            SELECT 
                event_data->>'pollutant' as pollutant,
                COUNT(*) as view_count
            FROM analytics_events 
            WHERE DATE(timestamp - INTERVAL '4 hours') = stats_date
            AND event_type IN ('linechart_drawn', 'data_export', 'chart_download')
            AND event_data->>'pollutant' IS NOT NULL
            GROUP BY event_data->>'pollutant'
            ORDER BY view_count DESC
            LIMIT 10
        ) AS daily_pollutants
    ) as popular_pollutants,
    -- Aggregate popular groups for the day  
    (
        SELECT jsonb_object_agg(group_name, usage_count)
        FROM (
            SELECT 
                jsonb_array_elements_text(event_data->'groups') as group_name,
                COUNT(*) as usage_count
            FROM analytics_events 
            WHERE DATE(timestamp - INTERVAL '4 hours') = stats_date
            AND event_type IN ('linechart_drawn', 'data_export', 'chart_download')
            AND event_data->'groups' IS NOT NULL
            GROUP BY jsonb_array_elements_text(event_data->'groups')
            ORDER BY usage_count DESC
            LIMIT 10
        ) AS daily_groups
    ) as popular_groups
FROM daily_stats_calculation
WHERE stats_date = CURRENT_DATE - INTERVAL '1 day' -- Yesterday's data
ON CONFLICT (date) 
DO UPDATE SET 
    total_sessions = EXCLUDED.total_sessions,
    unique_users = EXCLUDED.unique_users,
    linechart_drawn = EXCLUDED.linechart_drawn,
    data_exports = EXCLUDED.data_exports,
    chart_downloads = EXCLUDED.chart_downloads,
    ui_interactions = EXCLUDED.ui_interactions,
    how_to_use_opens = EXCLUDED.how_to_use_opens,
    group_info_opens = EXCLUDED.group_info_opens,
    smoothing_toggles = EXCLUDED.smoothing_toggles,
    countries = EXCLUDED.countries,
    popular_pollutants = EXCLUDED.popular_pollutants,
    popular_groups = EXCLUDED.popular_groups,
    updated_at = NOW();

-- Optional: Clean up old raw events (keep last 90 days)
-- DELETE FROM analytics_events 
-- WHERE timestamp < CURRENT_DATE - INTERVAL '90 days';

-- Query to verify the aggregation worked
SELECT 
    date,
    total_sessions,
    unique_users,
    linechart_drawn,
    data_exports,
    ui_interactions
FROM daily_analytics 
ORDER BY date DESC 
LIMIT 7;