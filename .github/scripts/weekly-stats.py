#!/usr/bin/env python3
"""Collect last week's site stats from Log Analytics into a JSON file.

Used by .github/workflows/weekly-stats.yml. This repo is PUBLIC, so this
script never prints stats: it writes them to --out (encrypted by the workflow
before upload) and logs only progress lines. Query errors print the HTTP
status and the API error code/message, never result rows.

Weeks are Monday 00:00 to the next Monday 00:00 (exclusive) in
America/New_York, so "week" means the same thing in EDT and EST.

Auth: an access token from the Azure CLI session (azure/login OIDC in CI,
`az login` locally). Needs Log Analytics Reader on the workspace. Standard
library only.

Usage: weekly-stats.py --workspace-id <customerId> --out stats.json [--today YYYY-MM-DD]
"""

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

SCHEMA_VERSION = 1
TZ = ZoneInfo("America/New_York")
WEB_COMPONENT = "appi-colinshanahan-web"
STATUS_COMPONENT = "appi-colinshanahan-dev"
SITE_HOSTS = ("colinshanahan.dev", "www.colinshanahan.dev")
TOP_N = 10
API = "https://api.loganalytics.io"


class QueryError(Exception):
    pass


def week_bounds(today: date):
    """(start, end) for the last full Mon-Sun week before `today`, and the one before that."""
    this_monday = today - timedelta(days=today.weekday())
    weeks = []
    for back in (1, 2):
        start_day = this_monday - timedelta(days=7 * back)
        end_day = start_day + timedelta(days=7)
        weeks.append(
            (
                datetime.combine(start_day, time(0), TZ),
                datetime.combine(end_day, time(0), TZ),
            )
        )
    return weeks


def get_token() -> str:
    try:
        out = subprocess.run(
            ["az", "account", "get-access-token", "--resource", API,
             "--query", "accessToken", "-o", "tsv"],
            check=True, capture_output=True, text=True,
        )
    except FileNotFoundError:
        raise QueryError("Azure CLI (az) not found")
    except subprocess.CalledProcessError as e:
        # stderr from az is an auth error message, not data.
        raise QueryError("could not get a Log Analytics token: " + e.stderr.strip()[:500])
    token = out.stdout.strip()
    if not token:
        raise QueryError("empty Log Analytics token")
    return token


def run_query(token: str, workspace_id: str, kql: str, name: str):
    """Run KQL, return a list of dicts. Raises QueryError without exposing rows."""
    req = urllib.request.Request(
        f"{API}/v1/workspaces/{workspace_id}/query",
        data=json.dumps({"query": kql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            err = json.load(e).get("error", {})
            inner = err.get("innererror", {}) or {}
            detail = f" {err.get('code', '')}: {err.get('message', '')} {inner.get('code', '')} {inner.get('message', '')}"
        except Exception:
            pass
        raise QueryError(f"query '{name}' failed: HTTP {e.code}{detail[:600]}")
    except urllib.error.URLError as e:
        raise QueryError(f"query '{name}' failed: {e.reason}")
    if body.get("error"):
        # Partial errors (e.g. throttling) come back as 200 with an error object.
        raise QueryError(f"query '{name}' returned an error: {body['error'].get('code', 'unknown')}")
    tables = body.get("tables") or []
    if not tables:
        raise QueryError(f"query '{name}' returned no result table")
    t = tables[0]
    cols = [c["name"] for c in t["columns"]]
    return [dict(zip(cols, row)) for row in t["rows"]]


def kql_time(dt: datetime) -> str:
    return "datetime(" + dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + ")"


def page_views(start: datetime, end: datetime) -> str:
    # SyntheticSource: App Insights marks known bots/tests; the browser SDK
    # already skips bots, headless browsers and GPC/DNT visitors.
    return f"""AppPageViews
| where TimeGenerated >= {kql_time(start)} and TimeGenerated < {kql_time(end)}
| where _ResourceId has '{WEB_COMPONENT}'
| where isempty(SyntheticSource)"""


def collect_week(token, ws, start, end):
    base = page_views(start, end)
    totals = run_query(token, ws, base + """
| summarize uniqueVisitors = dcount(UserId), sessions = dcount(SessionId), pageViews = count()""", "totals")
    t = totals[0] if totals else {}

    pages = run_query(token, ws, base + f"""
| extend path = tostring(parse_url(Url).Path)
| extend path = iff(isempty(path), '/', path)
| summarize pageViews = count(), uniqueVisitors = dcount(UserId) by path
| top {TOP_N} by pageViews desc""", "top pages")

    host_filter = ", ".join(f"'{h}'" for h in SITE_HOSTS)
    referrers = run_query(token, ws, base + f"""
| extend ref = tostring(Properties.refUri)
| where isnotempty(ref)
| extend refHost = tolower(tostring(parse_url(ref).Host))
| where isnotempty(refHost) and refHost !in ({host_filter})
| summarize sessions = dcount(SessionId), pageViews = count() by host = refHost
| top {TOP_N} by sessions desc""", "top referrers")

    countries = run_query(token, ws, base + f"""
| extend country = iff(isempty(ClientCountryOrRegion), 'Unknown', ClientCountryOrRegion)
| summarize uniqueVisitors = dcount(UserId), pageViews = count() by country
| top {TOP_N} by uniqueVisitors desc""", "top countries")

    regions = run_query(token, ws, base + f"""
| extend country = iff(isempty(ClientCountryOrRegion), 'Unknown', ClientCountryOrRegion),
         region = iff(isempty(ClientStateOrProvince), 'Unknown', ClientStateOrProvince)
| summarize uniqueVisitors = dcount(UserId), pageViews = count() by country, region
| top {TOP_N} by uniqueVisitors desc""", "top regions")

    uptime_rows = run_query(token, ws, f"""AppAvailabilityResults
| where TimeGenerated >= {kql_time(start)} and TimeGenerated < {kql_time(end)}
| where _ResourceId has '{STATUS_COMPONENT}'
| summarize checks = count(), passed = countif(Success == true), locations = dcount(Location)""", "uptime")
    u = uptime_rows[0] if uptime_rows else {}
    checks = int(u.get("checks") or 0)
    passed = int(u.get("passed") or 0)
    uptime = {
        "available": checks > 0,
        "percent": round(100.0 * passed / checks, 3) if checks else None,
        "checks": checks,
        "failedChecks": checks - passed,
        "locations": int(u.get("locations") or 0),
        "source": f"{STATUS_COMPONENT} availability tests",
    }

    def ints(rows, keys):
        return [{k: (int(v) if k in keys and v is not None else v) for k, v in r.items()} for r in rows]

    return {
        "range": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "endExclusive": True,
            "label": f"{start:%a %b %-d} – {(end - timedelta(days=1)):%a %b %-d, %Y}",
            "startUtc": start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endUtc": end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "uniqueVisitors": int(t.get("uniqueVisitors") or 0),
        "sessions": int(t.get("sessions") or 0),
        "pageViews": int(t.get("pageViews") or 0),
        "topPages": ints(pages, {"pageViews", "uniqueVisitors"}),
        "topReferrers": ints(referrers, {"sessions", "pageViews"}),
        "topCountries": ints(countries, {"uniqueVisitors", "pageViews"}),
        "topRegions": ints(regions, {"uniqueVisitors", "pageViews"}),
        "uptime": uptime,
    }


def pct_change(cur, prev):
    if not prev:
        return None
    return round(100.0 * (cur - prev) / prev, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace-id", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--today", help="YYYY-MM-DD in America/New_York (default: now)")
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else datetime.now(TZ).date()
    (cur_s, cur_e), (prev_s, prev_e) = week_bounds(today)

    try:
        token = get_token()
        print("collecting last week", flush=True)
        cur = collect_week(token, args.workspace_id, cur_s, cur_e)
        print("collecting the week before", flush=True)
        prev = collect_week(token, args.workspace_id, prev_s, prev_e)
    except QueryError as e:
        print(f"::error::{e}", file=sys.stderr)
        sys.exit(1)

    stats = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": "America/New_York",
        "site": "https://www.colinshanahan.dev",
        "source": {
            "workspaceTable": "AppPageViews",
            "component": WEB_COMPONENT,
            "notes": "uniqueVisitors/sessions are dcount() estimates; visitors with GPC/DNT, bots and headless browsers are not tracked.",
        },
        "week": cur,
        "previousWeek": prev,
        "change": {
            "uniqueVisitorsPct": pct_change(cur["uniqueVisitors"], prev["uniqueVisitors"]),
            "sessionsPct": pct_change(cur["sessions"], prev["sessions"]),
            "pageViewsPct": pct_change(cur["pageViews"], prev["pageViews"]),
        },
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {args.out}", flush=True)


if __name__ == "__main__":
    main()
