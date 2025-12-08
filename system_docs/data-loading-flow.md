# Initial Data Loading Flow (Bubble & Line)

This note captures the current control flow for the first stage of data loading inside `bubblechart/supabase.js` and `linechart/supabase.js`. The diagrams focus on the logic that decides which dataset source (snapshot, hero, shared Supabase bootstrap, direct Supabase) is used before the UI renders any rows.

## Bubble Chart — `loadData()`

**Key checkpoints**
- Always emits `sbase_data_queried` before touching loaders so analytics can see override/snapshot eligibility.
- Prefers cached full datasets from the shared loader; cache hits now emit `sbase_data_loaded` with `source = cache` / `loadMode = full-cache`, signalling the data still originated from Supabase even though the request happened earlier.
- The race pits a shared Supabase bootstrap against the snapshot promise. Supabase wins mark the dataset "full"; snapshots keep `hasFullDataset = false` but still trigger `triggerBubbleHydration`.
- If the race does not land on Supabase, the loader continues by requesting the hero dataset, then `SharedDataLoader.loadSharedData`, and finally a direct Supabase fetch.
- Every path updates `latestDatasetSource`, merges selector metadata when partial, and reuses the shared loader’s cached payload so both charts avoid redundant queries.

```mermaid
flowchart TD
  A[loadData invoked] --> E[track sbase_data_queried]
  E --> F{Shared loader cache ready?}
  F -- yes --> G[use cached full dataset]
  F -- no --> H{Can short-circuit snapshot?}
  H -- yes --> I[request default snapshot]
  I --> J{snapshot resolves?}
  J -- yes --> K[apply snapshot rows, mark partial]
  J -- no --> L
  H -- no --> L[Prepare dataset race]
  L --> M{Shared Supabase bootstrap succeeds first?}
  M -- yes --> N[apply bootstrap data, mark full]
  M -- no --> O{Snapshot wins race?}
  O -- yes --> P[apply snapshot rows, mark partial]
  O -- no --> Q
  Q --> R{Shared loader fallback available?}
  R -- yes --> S[shared-loader full dataset]
  R -- no --> T{Hero dataset available?}
  T -- yes --> U[apply hero dataset, partial]
  T -- no --> V[direct Supabase full fetch]
  K & N & P & S & U & V --> W[applyDataset + emit analytics]
```

## Line Chart — `loadData()`

**Key checkpoints**
- Logs snapshot eligibility + overrides, then emits `sbase_data_queried` before touching any loader.
- Checks the shared loader cache first. If empty, evaluates whether it can immediately render from the default snapshot. Cache wins now trigger `sbase_data_loaded` with `source = cache` / `loadMode = full-cache` so analytics dashboards still see a Supabase lifecycle success even though no fresh fetch occurred.
- When both a Supabase bootstrap and a snapshot are viable, it runs `waitForFirstDatasetCandidate` to race them. Supabase wins yield `datasetSource = 'shared-bootstrap'`, while snapshots keep the dataset partial but still schedule hydration.
- After the race, it retries the shared loader cache (in case bootstrap-filled it), then falls back to the hero dataset for partial Supabase hydration. Hero success schedules a background full dataset load.
- If all else fails, it invokes `loadDataDirectly()` to hit Supabase for pollutants, categories, and timeseries. Every successful path feeds `applyLineDataset` and may emit `sbase_data_loaded` when the source is Supabase-backed.

```mermaid
flowchart TD
  A[loadData invoked] --> B[track sbase_data_queried]
  B --> C{Shared loader cache ready?}
  C -- yes --> D[use cached full dataset]
  C -- no --> E{Can short-circuit snapshot?}
  E -- yes --> F[request default snapshot]
  F --> G{snapshot resolves?}
  G -- yes --> H[apply snapshot rows, partial]
  G -- no --> I
  E -- no --> I[Setup race]
  I --> J{Supabase bootstrap wins?}
  J -- yes --> K[apply bootstrap data, full]
  J -- no --> L{Snapshot wins?}
  L -- yes --> H
  L -- no --> M
  M --> N{Shared loader cache now loaded?}
  N -- yes --> D
  N -- no --> O{Hero dataset available?}
  O -- yes --> P[apply hero dataset, partial + schedule full load]
  O -- no --> Q[direct Supabase full fetch]
  H & K & P & Q & D --> R[applyLineDataset]
  R --> S{Full dataset?}
  S -- yes --> T[mark full, emit analytics]
  S -- no --> U[trigger hydration, track partial]
```
