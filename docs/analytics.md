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
