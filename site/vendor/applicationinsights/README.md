# Vendored: Application Insights JavaScript SDK (browser)

Self-hosted so the site's CSP needs no third-party **script** origin
(`script-src 'self'`) and nothing is pulled from `js.monitor.azure.com` at runtime.

| | |
|---|---|
| Package | [`@microsoft/applicationinsights-web`](https://www.npmjs.com/package/@microsoft/applicationinsights-web) **3.4.5** (pinned) |
| File | `ai.3.4.5.gbl.min.js`, byte-identical to `package/browser/es5/ai.3.4.5.gbl.min.js` in the npm tarball |
| npm tarball | `https://registry.npmjs.org/@microsoft/applicationinsights-web/-/applicationinsights-web-3.4.5.tgz` (`sha512-ZXfOjlrccdIxTap04GbswmXOQdHD5406x93jB5egqMYQs2EhCWoyX9DVJ/p6qPeikytqiDaldywt1ACIl6Zl2Q==`) |
| Same file on Microsoft's CDN | `https://js.monitor.azure.com/scripts/b/ai.3.4.5.gbl.min.js` (verified identical) |
| SRI (sha384) | `sha384-aTKCfGVKAFg+If03Hanf/RLpTadzuv1kyXFITdZe/xx2AW3KxVHNVKRTjUz40hVh` (matches the package's own `ai.3.4.5.integrity.json`) |
| License | MIT, see `LICENSE` (copied from the package) |

`/analytics.js` loads it with that `integrity` value, and
`.github/scripts/check-site.mjs` fails the build if the file and the pinned hash drift.

## Upgrading

```sh
V=3.x.y
npm pack @microsoft/applicationinsights-web@$V
tar xzf microsoft-applicationinsights-web-$V.tgz
cp package/browser/es5/ai.$V.gbl.min.js site/vendor/applicationinsights/
git rm site/vendor/applicationinsights/ai.<old>.gbl.min.js
openssl dgst -sha384 -binary site/vendor/applicationinsights/ai.$V.gbl.min.js | base64
# compare with package/browser/es5/ai.$V.integrity.json ("@gbl.min.js" sha384),
# then update SDK_VERSION + SDK_SRI in site/analytics.js and this README.
```

Re-check new releases for extra network calls (CDN config sync, SDK stats)
before bumping: `site/analytics.js` turns those off, and the Playwright test
`tests/analytics.spec.mjs` fails if the SDK contacts any origin other than the
site and the ingestion endpoint.
