# Runtime Supabase Config Injection

Both the public data explorer and the private analytics dashboard now expect their Supabase credentials to be supplied at runtime via `window.__NAEI_SUPABASE_CONFIG`. The generated `SharedResources/supabase-env.js` file is gitignored so secrets never land in the repository—CI/CD pipelines must create it during each build/deploy.

## Required Secrets
Add the following repository (or environment) secrets in GitHub Actions for **each** repo:

| Secret | Description |
| --- | --- |
| `NAEI_SUPABASE_URL` | The Supabase project URL (e.g. `https://xyzsupabase.supabase.co`). |
| `NAEI_SUPABASE_PUBLISHABLE_KEY` | The publishable/browser key (formerly `anon`). |
| `NAEI_SUPABASE_STORAGE_KEY_BASE` (optional) | Custom auth storage prefix. If omitted, the script derives it from the URL hostname. |

> Tip: keep analytics pointed to the same Supabase project so the dashboard and explorer read/write the same `site_events` tables.

## Sample GitHub Actions Step (Explorer Repo)
Insert this step **before** you upload artifacts or publish to Pages:

```yaml
    - name: Write Supabase runtime config
      working-directory: CIC-test-uk-air-pollution-emissions-data-explorer
      env:
        SUPABASE_URL: ${{ secrets.NAEI_SUPABASE_URL }}
        SUPABASE_KEY: ${{ secrets.NAEI_SUPABASE_PUBLISHABLE_KEY }}
        STORAGE_KEY_BASE: ${{ secrets.NAEI_SUPABASE_STORAGE_KEY_BASE }}
      run: |
        set -euo pipefail
        STORAGE_KEY="${STORAGE_KEY_BASE:-}"
        if [ -z "$STORAGE_KEY" ]; then
          HOST=$(node -p "new URL(process.env.SUPABASE_URL).hostname.split('.')[0]")
          STORAGE_KEY="sb-${HOST}-auth-token"
        fi
        cat <<EOF > SharedResources/supabase-env.js
        window.__NAEI_SUPABASE_CONFIG = Object.freeze({
          url: "${SUPABASE_URL}",
          key: "${SUPABASE_KEY}",
          storageKeyBase: "${STORAGE_KEY}"
        });
        EOF
```

- Adjust `working-directory` if your workflow already `cd`s into the repo.
- Keep the step idempotent—reruns overwrite the file with the same content, which is fine because it is not committed.

## Sample GitHub Actions Step (Analytics Repo)
The analytics repo is much smaller, so the step can be identical (only the path changes):

```yaml
    - name: Write Supabase runtime config (analytics)
      working-directory: CIC-test-data-explorer-analytics
      env:
        SUPABASE_URL: ${{ secrets.NAEI_SUPABASE_URL }}
        SUPABASE_KEY: ${{ secrets.NAEI_SUPABASE_PUBLISHABLE_KEY }}
        STORAGE_KEY_BASE: ${{ secrets.NAEI_SUPABASE_STORAGE_KEY_BASE }}
      run: |
        set -euo pipefail
        STORAGE_KEY="${STORAGE_KEY_BASE:-}"
        if [ -z "$STORAGE_KEY" ]; then
          HOST=$(node -p "new URL(process.env.SUPABASE_URL).hostname.split('.')[0]")
          STORAGE_KEY="sb-${HOST}-analytics-auth"
        fi
        cat <<EOF > SharedResources/supabase-env.js
        window.__NAEI_SUPABASE_CONFIG = Object.freeze({
          url: "${SUPABASE_URL}",
          key: "${SUPABASE_KEY}",
          storageKeyBase: "${STORAGE_KEY}"
        });
        EOF
```

- Feel free to reuse the same secrets from the explorer repo by referencing an organization environment, or duplicate them if the repos use separate workflows.
- If you omit `NAEI_SUPABASE_STORAGE_KEY_BASE`, the dashboards will fall back to the derived key reported by `supabase-config.js`—passing it explicitly just keeps client storage names predictable across deployments.

## Local Verification Checklist
1. Copy `SharedResources/supabase-env.template.js` to `SharedResources/supabase-env.js` (in both repos) and paste the publishable URL/key for your test project.
2. Load the explorer shell or analytics dashboard locally and open DevTools → Console. You should see `SupabaseConfig` defined with the expected URL.
3. Rotate keys by updating the secrets and redeploying—no repository changes are required.

Keeping the runtime file out of git ensures accidental commits cannot leak publishable keys while still letting each environment (local, preview, production) define its own Supabase credentials.
