# Visitor analytics (Application Insights, browser SDK)

colinshanahan.dev counts real visitors with the Application Insights JavaScript
SDK. This page covers how it's wired, how to turn it on, and how to read the numbers.

## How it fits together

```
browser ── /analytics.js (self-hosted) ──► /vendor/applicationinsights/ai.3.4.5.gbl.min.js (SRI-pinned)
   │
   └─ POST https://<region>-N.in.applicationinsights.azure.com/v2/track
          │
          ▼
   appi-colinshanahan-web  (rg-portfolio, this repo's Terraform)
          │  workspace-based
          ▼
   log-portfolio-status    (Log Analytics, rg-portfolio-status, 30-day retention)
          ▲
   appi-colinshanahan-dev  (availability tests → /status page, portfolio-status repo)
```

* **Separate component, shared workspace.** Browser telemetry goes to its own
  `appi-colinshanahan-web`, not the status project's `appi-colinshanahan-dev`.
  The browser connection string is public, so on the shared component anyone
  could forge `availabilityResults` and move the uptime number on /status. A daily
  cap there would also stop the availability data. Both components write to the
  same Log Analytics workspace, so you query and pay in one place.
* **Daily cap 0.1 GB** (`analytics_daily_cap_gb`), 30-day retention, IP masking
  on, local auth on (the browser SDK can only authenticate with the ingestion key).
* **Connection string delivery.** The deploy workflow reads the repository
  *variable* `APPINSIGHTS_CONNECTION_STRING` and
  `.github/scripts/inject-analytics.mjs` writes it into `site/analytics.js`. If it's
  empty, the site deploys unchanged and the SDK never loads. If it's malformed or
  its ingestion origin isn't allowed by the CSP, the deploy fails with the reason.
* **CSP.** `script-src` is unchanged (`'self'` + hashes). `connect-src` gains
  `https://*.in.applicationinsights.azure.com`, because the regional host
  (`centralus-N…`) is only known after the resource exists and CSP can't
  wildcard part of a label. Once it exists you can pin it (see below). The SDK's
  CDN config sync (`js.monitor.azure.com`) and SDK self-stats are turned off, and
  dependency (AJAX/fetch) tracking is disabled, so nothing else is contacted. A
  Playwright test fails if any other origin is requested.

### What is and isn't collected

| Collected | Not collected / not loaded |
|---|---|
| Page views: title, URL **path only** (query + `#fragment` stripped), referrer origin + path | `/admin` (never includes the script) |
| `ai_user` / `ai_session` cookie ids, so unique users and sessions work | Anything typed (résumé form), clicks, AJAX/fetch calls |
| Browser, OS, device type, page load timing | Full IP (Azure geolocates, then stores `0.0.0.0`) |
| Country / region / city (from IP) | Visitors with **GPC** or **Do Not Track** on |
| Uncaught JS exceptions | `navigator.webdriver` (Playwright CI and smoke runs against prod), headless browsers, bot/crawler UAs |

The availability tests that feed /status don't execute JavaScript and write to
the other component, so they never show up as browser users.

The visitor-facing explanation is at [/privacy](https://www.colinshanahan.dev/privacy).

## Turning it on (one time, after merge)

1. **Apply Terraform** (Colin approves and runs it; it creates only `appi-colinshanahan-web`):
   ```sh
   cd infra
   az login   # Shanahan Enterprises Development subscription
   terraform init
   terraform plan    # expect: 1 to add (azurerm_application_insights.web), 0 to change, 0 to destroy
   terraform apply
   ```
   The plan reads `log-portfolio-status` in `rg-portfolio-status` through a data
   source, so that workspace must be in the same subscription. If it isn't, plan
   fails on the data source; set `analytics_workspace_*` or move the component.
2. **Set the repository variable** (Variables, not Secrets):
   ```sh
   gh variable set APPINSIGHTS_CONNECTION_STRING \
     --repo cjshanahan1228/colinshanahan.dev-portfolio \
     --body "$(terraform output -raw appinsights_web_connection_string)"
   ```
   Or use GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable.
3. **Redeploy**: Actions → *Deploy portfolio* → *Run workflow* on `main`
   (`gh workflow run deploy.yml --ref main`). Changing a variable doesn't trigger a
   deploy by itself. The *Configure browser analytics* step should log
   `analytics.js configured (ingestion: https://centralus-N.in.applicationinsights.azure.com)`.
4. **Verify**: open the site in a normal browser window (GPC/DNT off, no
   ad blocker). You should see the cookie notice, and DevTools → Network should
   show `ai.3.4.5.gbl.min.js` (200) and a `v2/track` POST (200). After 2–5
   minutes, Application Insights → *Logs* → `pageViews | take 10` should return rows.
5. *(Optional hardening)* Pin `connect-src` to the exact origin from
   `terraform output appinsights_web_ingestion_origin` instead of the
   `*.in.applicationinsights.azure.com` wildcard, and update the expectation in
   `tests/security.spec.mjs`. The deploy step refuses a connection string the CSP
   doesn't allow, so a mismatch can't ship.

## Where to look in the portal

Azure portal → **Application Insights → `appi-colinshanahan-web`**:

* **Usage → Users**: unique users over time, by country, browser, OS. Use
  *Split by* and the time range picker.
* **Usage → Sessions**: sessions over time and pages per session.
* **Usage → Events**: page views per page (*Who used* → page view events).
* **Usage → Retention / User Flows**: returning visitors and the paths between pages.
* **Logs**: the KQL below. Queries run from the Application Insights resource
  use the classic table names (`pageViews`). From the Log Analytics workspace
  use `AppPageViews` (see the bottom of this page).
* **Usage and estimated costs** shows ingested volume against the daily cap.

## KQL (run from the Application Insights resource → Logs)

**Unique visitors, sessions and page views per day**
```kusto
pageViews
| where timestamp > ago(30d)
| summarize visitors = dcount(user_Id), sessions = dcount(session_Id), views = count()
    by day = bin(timestamp, 1d)
| order by day asc
| render timechart
```

**Totals for a period** (`dcount` is an estimate, accurate to about 1% at these volumes)
```kusto
pageViews
| where timestamp > ago(7d)
| summarize visitors = dcount(user_Id), sessions = dcount(session_Id), views = count()
```

**Top pages**
```kusto
pageViews
| where timestamp > ago(30d)
| summarize views = count(), visitors = dcount(user_Id) by page = tostring(parse_url(url).Path), name
| top 20 by views
```

**Referrers** (where visitors came from; empty = direct / typed / app)
```kusto
pageViews
| where timestamp > ago(30d)
| extend ref = tostring(customDimensions.refUri)
| where isnotempty(ref) and ref !startswith "https://www.colinshanahan.dev" and ref !startswith "https://colinshanahan.dev"
| summarize visits = dcount(session_Id) by referrer = tostring(parse_url(ref).Host)
| order by visits desc
```

**Countries / cities**
```kusto
pageViews
| where timestamp > ago(30d)
| summarize visitors = dcount(user_Id) by client_CountryOrRegion, client_City
| order by visitors desc
```

**Sessions: pages per visit, duration, bounce rate**
```kusto
pageViews
| where timestamp > ago(30d)
| summarize pages = count(), first = min(timestamp), last = max(timestamp) by session_Id
| summarize sessions = count(),
            avg_pages = round(avg(pages), 1),
            avg_minutes = round(avg(datetime_diff('second', last, first)) / 60.0, 1),
            bounce_rate_pct = round(100.0 * countif(pages == 1) / count(), 1)
```

**New vs. returning visitors**
```kusto
let window = 30d;
let firstSeen = pageViews | summarize first = min(timestamp) by user_Id;
pageViews
| where timestamp > ago(window)
| join kind=inner firstSeen on user_Id
| summarize visitors = dcount(user_Id) by kind = iff(first > ago(window), "new", "returning")
```

**Devices and browsers**
```kusto
pageViews
| where timestamp > ago(30d)
| summarize visitors = dcount(user_Id) by client_Type, client_Browser, client_OS
| order by visitors desc
```

**Is the case-studies page being read?** (time on page isn't tracked; this shows who reached it)
```kusto
pageViews
| where timestamp > ago(30d) and url endswith "/case-studies"
| summarize visitors = dcount(user_Id), views = count() by bin(timestamp, 1d)
```

**JS errors visitors hit**
```kusto
exceptions
| where timestamp > ago(7d)
| summarize count(), visitors = dcount(user_Id) by problemId, outerMessage
| order by count_ desc
```

### Same queries from the Log Analytics workspace

Workspace tables use different names. Filter to this component, because the
workspace also holds the status project's data:

```kusto
AppPageViews
| where TimeGenerated > ago(30d)
| where _ResourceId endswith "/components/appi-colinshanahan-web"
| summarize visitors = dcount(UserId), sessions = dcount(SessionId), views = count() by bin(TimeGenerated, 1d)
```
(`url` → `Url`, `client_CountryOrRegion` → `ClientCountryOrRegion`,
`customDimensions.refUri` → `Properties.refUri`.)

## Weekly stats email (encrypted, read-only)

Every Monday a GitHub Actions workflow collects last week's numbers so Colin's
assistant can email them at 8:09 AM ET. No Azure credential is stored on the
assistant's box or in GitHub.

```
weekly-stats.yml (Mon 11:23 UTC = 7:23 EDT / 6:23 EST, or Run workflow)
   │  environment: stats (main branch only)
   │  OIDC token: repo:cjshanahan1228/colinshanahan.dev-portfolio:environment:stats
   ▼
id-portfolio-stats ── Log Analytics Reader ──► log-portfolio-status (only role it has)
   │  .github/scripts/weekly-stats.py: AppPageViews (appi-colinshanahan-web)
   │                                   AppAvailabilityResults (appi-colinshanahan-dev)
   ▼
stats.json ── age --encrypt -r $STATS_AGE_RECIPIENT ──► artifact "weekly-stats" (stats.json.age, 14 days)
                                                              │
assistant box: ~/bin/fetch-site-stats.sh ── gh run download ──┘ ── age --decrypt (private key stays on the box)
```

**What's collected** (`stats.json`, `schemaVersion: 1`): for the previous full
week (Monday 00:00 to the next Monday 00:00, America/New_York, so DST weeks
are handled) and the week before: unique visitors (`dcount(UserId)`), sessions,
page views, top 10 pages, top 10 referrer hosts (the site's own hosts
excluded), top 10 countries and country/region pairs, uptime % from the status
project's availability tests, week-over-week % change, the exact date ranges
(local and UTC) and `generatedAt`.

**Why it's built this way**

* **No secrets.** `azure/login` exchanges GitHub's OIDC token for an Entra
  token. Nothing to rotate or leak. A managed identity can't be used from the
  assistant's box directly (it isn't in Azure), so GitHub runs the query and the
  box only talks to GitHub, which it's already signed into.
* **Least privilege.** `id-portfolio-stats` is a separate identity from the
  deploy identity. Its only role is **Log Analytics Reader on the one
  workspace**: no subscription or resource-group role, no write access. Its
  federated credential trusts only the `stats` environment, and that
  environment's deployment branch policy allows only `main`. A pull request,
  fork or other branch can't get a token for it.
* **The repo is public.** Anyone can read run logs, job summaries and (when
  signed in to GitHub) download artifacts. So the script never prints stats; it
  logs progress and, on failure, only the HTTP status and API error code. The
  job summary just says the stats were generated and encrypted. The JSON is
  encrypted with [age](https://age-encryption.org) to a public key
  (`STATS_AGE_RECIPIENT`) and only `stats.json.age` is uploaded. The private
  identity lives at `~/.config/portfolio-stats/age.key` (mode 600) on the
  assistant's box and nowhere else. age is downloaded at a pinned version and
  checked against a hardcoded SHA-256 before use.
* **Fails closed.** Any query error, an empty token, or invalid JSON fails the
  job before anything is uploaded. The fetch script refuses runs older than 8
  days, so a stale week is never emailed as if it were new.

**Repository variables** (Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
|---|---|
| `STATS_AZURE_CLIENT_ID` | `terraform output -raw stats_azure_client_id` (set after apply) |
| `AZURE_TENANT_ID` | already set for `deploy.yml`, reused |
| `STATS_WORKSPACE_ID` | `terraform output -raw stats_workspace_id` (workspace/customer ID) |
| `STATS_AGE_RECIPIENT` | age public key (`age1...`) from `age-keygen -y ~/.config/portfolio-stats/age.key` |

**GitHub environment `stats`**: Settings → Environments → `stats` →
Deployment branches and tags → *Selected branches* → `main`. No required
reviewers (it runs unattended), no environment secrets.

### Turning it on (one time, after merge)

1. **Apply Terraform** (Colin approves): `cd infra && terraform plan` should
   show **3 to add, 0 to change, 0 to destroy**:
   `azurerm_user_assigned_identity.stats` (`id-portfolio-stats`),
   `azurerm_federated_identity_credential.stats_environment`
   (`github-environment-stats`), and
   `azurerm_role_assignment.stats_workspace_reader` (Log Analytics Reader on
   `log-portfolio-status`). Then `terraform apply`.
2. **Set the client ID variable**:
   ```sh
   gh variable set STATS_AZURE_CLIENT_ID \
     --repo cjshanahan1228/colinshanahan.dev-portfolio \
     --body "$(terraform output -raw stats_azure_client_id)"
   ```
3. **Run it once**: `gh workflow run weekly-stats.yml --ref main`, then
   `gh run watch`. A new role assignment can take a few minutes to apply; if
   the first run fails with 403 `InsufficientAccessError`, re-run it.
4. **Verify decryption** on the assistant's box:
   `~/bin/fetch-site-stats.sh | python3 -m json.tool | head` (exit 0 = good;
   2 = no successful run in the last 8 days; 3 = download failed; 4 =
   decryption failed).

### Maintenance

* **Rotating the age key**: generate a new key on the box (`age-keygen -o`),
  `gh variable set STATS_AGE_RECIPIENT` to its public key, re-run the workflow.
  Old artifacts expire after 14 days.
* **Upgrading age**: change `AGE_VERSION` and `AGE_SHA256` in
  `weekly-stats.yml` together (the digest is listed on the GitHub release asset).
* **Scheduled workflows on public repos are disabled after 60 days with no
  repository activity.** If the Monday email reports no recent run, check
  Actions → *Weekly stats* and re-enable it.
* **Turning it off**: disable the workflow, then remove the three resources
  from `infra/main.tf` and apply.

## Cost

Ingestion is billed by the Log Analytics workspace. Analytics Logs: **the first
5 GB per billing account per month are free**, then $2.76/GB in Central US
(Azure retail prices API, Oct 2026). Retention up to 31 days is included
(Application Insights data: 90 days), and this resource keeps 30.
A page load sends about 2 KB (page view + page view performance), so 10,000
page views/month is about 20 MB. The 0.1 GB/day cap bounds abuse at about
3.1 GB/month, still inside the free allowance unless other workspaces on the
billing account already use it. In that case the worst case is about $9/month.
Sources: <https://azure.microsoft.com/pricing/details/monitor/>,
<https://learn.microsoft.com/azure/azure-monitor/logs/cost-logs>.

## Maintenance

* **SDK upgrades**: see `site/vendor/applicationinsights/README.md`.
  `check-site.mjs` verifies the vendored file against the pinned SRI.
* **Turning analytics off**: delete the repository variable and re-run the deploy.
  The script then never loads and the notice disappears. Data already collected
  ages out after 30 days.
