# colinshanahan.dev — portfolio as working infrastructure

Site on Azure Static Web Apps · resume on public-read Blob Storage · both
deployed by GitHub Actions — the resume job authenticates via **OIDC
federation** (user-assigned managed identity, federated credential pinned to
`main`), so no cloud credentials are stored in GitHub.

```
portfolio-deploy/
├── .github/workflows/deploy.yml  # deploy site (SWA) + publish resume (Blob/OIDC)
├── infra/main.tf                 # SWA + storage + GitHub OIDC identity
├── resume/                       # source files → Blob Storage via CI
└── site/                         # index.html, status.html → Static Web Apps
```

## Setup

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

## Related

`site/status.html` is the front-end of the live ops dashboard —
telemetry API and monitoring live in
[portfolio-status](https://github.com/cjshanahan1228/portfolio-status).
