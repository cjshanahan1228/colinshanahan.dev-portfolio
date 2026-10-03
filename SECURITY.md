# Security policy

This repository is a personal portfolio (`colinshanahan.dev`) that doubles as a
working infrastructure demo. Security reports are welcome.

## Reporting

- Preferred: [open a private security advisory](https://github.com/cjshanahan1228/colinshanahan.dev-portfolio/security/advisories/new)
  (GitHub private vulnerability reporting).
- Otherwise email the address on <https://www.colinshanahan.dev/#contact> with
  "security" in the subject.

Please don't open a public issue for anything exploitable, and don't test with
automated scanners or load against the live site or its API. I aim to
acknowledge within a few days.

## Scope

In scope: the site, the `/api` functions, the GitHub Actions workflows and the
Terraform in this repo. Out of scope: Azure/GitHub platform issues (report those
to Microsoft / GitHub), social engineering, denial of service.

## Design notes

- The resume is delivered only through an owner-approved request flow; the blob
  container is private and links are time-limited SAS URLs.
- CI authenticates to Azure with GitHub OIDC (no stored cloud credentials); the
  only repository secret is the Static Web Apps deployment token.
- The site ships a strict Content-Security-Policy (see
  `site/staticwebapp.config.json`); inline scripts are allowed by hash only and
  `node .github/scripts/csp-hashes.mjs --write` keeps the hash list in sync.
