/* Visitor analytics for colinshanahan.dev: Azure Application Insights
   (browser SDK), self-hosted under /vendor so the CSP keeps script-src 'self'.

   Loaded with `defer` on the public pages only. /admin never includes it,
   and the path guard below is a second lock on that door.

   Nothing loads, no cookie is set and no notice is shown when:
     - the deploy had no APPINSIGHTS_CONNECTION_STRING (local, PR previews,
       or before the resource exists): CONNECTION_STRING stays "" below
     - navigator.webdriver is true (Playwright CI/smoke runs, other automation)
     - the user agent is an obvious bot/crawler/monitor
     - Global Privacy Control or Do Not Track is on

   What is collected: page views (page title, URL path WITHOUT query string or
   fragment, referrer origin + path), anonymous user/session ids from the
   ai_user / ai_session cookies, browser/OS/device type, page load timing and
   uncaught JS errors. Country/city are derived by Azure from the IP, which is
   then masked (stored as 0.0.0.0). No form input, no clicks, no AJAX calls. */
(function () {
  "use strict";

  // Written at deploy time by .github/scripts/inject-analytics.mjs from the
  // repository variable APPINSIGHTS_CONNECTION_STRING. Leave as "" in git.
  var CONNECTION_STRING = /*@APPINSIGHTS_CONNECTION_STRING@*/ "";

  // Pinned, vendored SDK. See site/vendor/applicationinsights/README.md.
  var SDK_VERSION = "3.4.5";
  var SDK_SRC = "/vendor/applicationinsights/ai." + SDK_VERSION + ".gbl.min.js";
  var SDK_SRI = "sha384-aTKCfGVKAFg+If03Hanf/RLpTadzuv1kyXFITdZe/xx2AW3KxVHNVKRTjUz40hVh";

  var NOTICE_KEY = "cookie-notice-dismissed";
  var BOTS =
    /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|python|curl|wget|httpclient|axios|node-fetch|go-http|java\/|okhttp|phantomjs|selenium|puppeteer|playwright/i;

  function optedOut() {
    var n = window.navigator || {};
    if (n.globalPrivacyControl === true) return true;
    return n.doNotTrack === "1" || n.doNotTrack === "yes" || window.doNotTrack === "1" || n.msDoNotTrack === "1";
  }

  function shouldTrack() {
    if (!CONNECTION_STRING) return false;
    if (/^\/admin(\.html)?(\/|$)/i.test(location.pathname)) return false;
    if (navigator.webdriver) return false;
    if (BOTS.test(navigator.userAgent || "")) return false;
    if (optedOut()) return false;
    return true;
  }

  if (!shouldTrack()) return;

  // ---- telemetry hygiene ---------------------------------------------------
  // Keep origin + path only: query strings and fragments can carry tokens or
  // personal data (e.g. an email address in a campaign link).
  function clean(url) {
    if (!url || typeof url !== "string") return url;
    try {
      var u = new URL(url, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
      return u.origin + u.pathname;
    } catch (e) {
      return undefined;
    }
  }

  function scrub(item) {
    var base = item && item.baseData;
    if (base) {
      if ("uri" in base) base.uri = clean(base.uri);
      if ("refUri" in base) base.refUri = clean(base.refUri);
      if ("url" in base) base.url = clean(base.url);
      var props = base.properties;
      if (props) {
        if ("refUri" in props) props.refUri = clean(props.refUri);
        if ("uri" in props) props.uri = clean(props.uri);
      }
    }
    if (item) {
      var tags = (item.tags = item.tags || {});
      // Never send an authenticated id; this site has no visitor accounts.
      delete tags["ai.user.authUserId"];
      // The SDK's default operation name is path + #fragment.
      tags["ai.operation.name"] = location.pathname;
    }
    return true;
  }

  function start() {
    var AI = window.Microsoft && window.Microsoft.ApplicationInsights;
    if (!AI || !AI.ApplicationInsights) return;
    var ai = new AI.ApplicationInsights({
      config: {
        connectionString: CONNECTION_STRING,
        // Multi-page site: one page view per load, sent explicitly below.
        enableAutoRouteTracking: false,
        // No dependency telemetry: the only cross-origin call is the status
        // API (noise), and it keeps correlation headers off every request.
        disableAjaxTracking: true,
        disableFetchTracking: true,
        disableCorrelationHeaders: true,
        // ai_user / ai_session cookies: what makes unique users and sessions work.
        disableCookiesUsage: false,
        autoTrackPageVisitTime: false,
        enableUnhandledPromiseRejectionTracking: false,
        samplingPercentage: 100,
        loggingLevelConsole: 0,
        // Features that would call other origins (and need more CSP holes):
        //   - CfgSync plugin: fetches js.monitor.azure.com/.../ai.config.1.cfg.json
        //   - SDK stats / throttle messages: extra telemetry about the SDK itself
        featureOptIn: {
          SdkStats: { mode: 2 },
          sdkStats: { mode: 2 },
          iKeyUsage: { mode: 2 },
          CdnUsage: { mode: 2 },
          SdkLoaderVer: { mode: 2 },
        },
        throttleMgrCfg: {
          106: { disabled: true },
          109: { disabled: true },
          110: { disabled: true },
          111: { disabled: true },
        },
        extensionConfig: {
          AppInsightsCfgSyncPlugin: { cfgUrl: "", blkCdnCfg: true, syncMode: 0 },
        },
      },
    });
    ai.loadAppInsights();
    if (ai.context && ai.context.telemetryTrace) ai.context.telemetryTrace.name = location.pathname;
    ai.addTelemetryInitializer(scrub);
    ai.trackPageView();
    window.appInsights = ai;
  }

  function loadSdk() {
    var s = document.createElement("script");
    s.src = SDK_SRC;
    s.integrity = SDK_SRI;
    s.crossOrigin = "anonymous";
    s.async = true;
    s.onload = start;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- cookie notice -------------------------------------------------------
  // A notice, not a consent wall: small, bottom of the viewport, never blocks
  // the page, dismissed once per browser (localStorage).
  function dismissed() {
    try {
      return localStorage.getItem(NOTICE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function showNotice() {
    if (dismissed() || document.getElementById("cookieNotice")) return;
    var box = document.createElement("aside");
    box.id = "cookieNotice";
    box.className = "cookie-notice";
    box.setAttribute("aria-label", "Cookie notice");

    var text = document.createElement("p");
    text.className = "cookie-notice__text";
    text.appendChild(
      document.createTextNode("This site uses Azure Application Insights cookies to count anonymous visits. ")
    );
    var link = document.createElement("a");
    link.href = "/privacy";
    link.textContent = "Privacy note";
    text.appendChild(link);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cookie-notice__dismiss";
    btn.textContent = "OK";
    btn.setAttribute("aria-label", "Dismiss cookie notice");
    btn.addEventListener("click", function () {
      try {
        localStorage.setItem(NOTICE_KEY, "1");
      } catch (e) {
        /* storage blocked: the notice just comes back next page */
      }
      box.remove();
    });

    box.appendChild(text);
    box.appendChild(btn);
    document.body.appendChild(box);
  }

  loadSdk();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showNotice);
  else showNotice();
})();
