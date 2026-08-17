# colinshanahan.dev — portfolio as working infrastructure

Site on Azure Static Web Apps · resume on **private** Blob Storage behind a
request/approval flow · both deployed by GitHub Actions — the resume job
authenticates via **OIDC federation** (user-assigned managed identity,
federated credential pinned to `main`), so no cloud credentials are stored in
GitHub.

```
portfolio-deploy/
├── .github/workflows/deploy.yml  # deploy site + api (SWA) + publish resume (Blob/OIDC)
├── api/                          # SWA managed functions: gated resume request/approval
├── infra/main.tf                 # SWA + storage + ACS email + GitHub OIDC identity
├── resume/                       # source files → private Blob Storage via CI
│   ├── resume-content.mjs        # the resume as data (single source of truth)
│   └── build-docx.mjs            # renders that content → .docx
└── site/                         # index.html, status.html → Static Web Apps
```

## Resume artifacts

The PDF is authored externally and committed as-is. The **Word version is
generated**, not hand-maintained: `resume/resume-content.mjs` holds the resume
as structured data and `build-docx.mjs` renders it with real Word constructs
(tab-stopped dates, native bullet lists, a live portfolio hyperlink), so it
stays editable by whoever receives it.

```bash
cd resume && npm install && npm run build   # → Colin-Shanahan-Resume.docx
```

Converting the PDF instead would reconstruct layout from glyph positions and
produce text boxes and broken lists — worse than useless for the one document
a recruiter is likely to edit. Edit the content file, rebuild, commit both.

## Gated resume access

Industry-standard gated-content flow — nobody downloads the resume anonymously:

1. Visitor submits the request form → `POST /api/resume-request` stores it in
   Table Storage and emails me (Azure Communication Services) with
   approve/deny capability links.
2. I click approve → `GET /api/resume-decision` mints **7-day read-only SAS
   URLs** for the PDF/DOCX and emails them to the requester. Deny closes the
   request silently.
3. The blob container is private — an approval-issued SAS link is the only
   way in. All settings (storage key, ACS connection string, sender/owner
   addresses) are Terraform-managed SWA app settings; nothing lives in CI.

## Setup

State is remote: `stcolinshanahanresume/tfstate/portfolio.tfstate` (azurerm
backend) — on any machine, `az login` + `terraform init` connects to it.
(From-scratch bootstrap only: comment out the backend block, apply locally,
create the `tfstate` container, restore the block, `terraform init -migrate-state`.)

1. `cd infra && terraform init && terraform apply`
2. Push to `github.com/cjshanahan1228/colinshanahan.dev-portfolio` (OIDC trust is
   bound to that exact name — change `github_repo` + re-apply if renamed)
3. Repo → Settings → Secrets and variables → Actions:
   - Secret `SWA_DEPLOYMENT_TOKEN` ← `terraform output -raw deployment_token`
   - Variables `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`
     ← matching outputs (identifiers, not secrets — that's the point of OIDC)
4. Run the workflow. Site live at `terraform output default_hostname`.
5. Custom domain: CNAME `www` → the SWA hostname, then
   `az staticwebapp hostname set -n swa-colinshanahan-portfolio --hostname www.colinshanahan.dev`

## Development workflow

Every change is tracked end-to-end: GitHub issue → linked branch
(`gh issue develop N --checkout`) → PR (title is a conventional commit) →
squash-merge to protected `main`. Merging deploys via the workflow above and
auto-publishes a semver tag + GitHub Release
(`.github/workflows/release.yml`) — `feat:` bumps minor, `fix:` bumps patch,
`!`/`BREAKING CHANGE` bumps major.

## Related

`site/status.html` is the front-end of the live ops dashboard —
telemetry API and monitoring live in
[portfolio-status](https://github.com/cjshanahan1228/portfolio-status).
