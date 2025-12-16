# Chart Colour Assignment Logic – v2.0 (in planning)

This document will capture the planned enhancements for the v2.0 colour system. Objectives:

1. **Source-driven rules**: tie palette decisions to specific `source_id`s from the cached `_category` metadata instead of relying on category name heuristics.
2. **Supabase-backed overrides**: load `public.color_source_rules` (see `system_docs/supabase_schema.sql`) so data editors can define `assign` and `exclude` behaviours per source, with priority ordering.
3. **Fallback logic**: use the existing `assessCategoryInclusion()` helper when no explicit rule matches, so we can still detect “Ecodesign is included” scenarios automatically.
4. **Shared module parity**: update `SharedResources/colors.js` so both bubble and line charts execute the new rule pipeline.

Future sections here will outline:
- Data flow from Supabase (rule loading, caching, invalidation).
- Exact rule resolution order (exclusions → lowest-priority assign → keyword fallback → final neutral colour).
- Migration notes for v1.0 → v2.0.

### Supabase bridge notes
- `public.color_source_rules` keeps a per-`source_id` record of both assigns and excludes so the front-end can load overrides before falling back to heuristics.
- The unique index on `(source_id, color_token, rule_kind)` enables seed scripts to use `ON CONFLICT DO UPDATE`, letting us re-run `system_docs/supabase_schema.sql` whenever colour mapping CSVs change without manual clean-up; reruns simply refresh priorities/notes for the same tuple.

(Placeholder for now—will expand as we implement the new logic.)
