# Deploying the portfolio to Azure Static Web Apps

This bundle provisions the hosting with Terraform and deploys the site through an
Azure DevOps pipeline — so the portfolio is itself a demo of how you work.

Estimated cost: **$0/month** (Static Web Apps Free tier) + ~$12/year if you add a
custom domain.

```
portfolio-deploy/
├── azure-pipelines.yml        # CI/CD: pushes /site to Static Web Apps
├── infra/
│   └── main.tf                # Terraform: resource group + Static Web App (Free)
└── site/
    ├── index.html             # the portfolio
    ├── staticwebapp.config.json
    ├── Colin-Shanahan-Resume.pdf
    └── Colin-Shanahan-Resume.docx
```

---

## Step 1 — Provision the Static Web App with Terraform

```bash
az login
cd infra
terraform init
terraform apply
```

When it finishes:

```bash
terraform output default_hostname        # your live URL
terraform output -raw deployment_token   # save for Step 3 (treat as a secret)
```

> SWA Free tier is only deployable in: `westus2`, `centralus`, `eastus2`,
> `westeurope`, `eastasia`. Default here is `eastus2` — closest to Charlotte.
> The content is served from a global edge network either way, so this only
> matters for management metadata.

## Step 2 — Put this folder in an Azure DevOps repo

1. Create a project (e.g. `portfolio`) at https://dev.azure.com
2. Push this folder as the repo root, with `main` as the default branch.

```bash
git init -b main
git add .
git commit -m "Portfolio site + IaC + pipeline"
git remote add origin https://dev.azure.com/<org>/portfolio/_git/portfolio
git push -u origin main
```

## Step 3 — Create the pipeline

1. Pipelines → New pipeline → Azure Repos Git → select the repo →
   "Existing Azure Pipelines YAML file" → `/azure-pipelines.yml`
2. Before running, add the variable:
   - Name: `SWA_DEPLOYMENT_TOKEN`
   - Value: the token from Step 1 (or fetch anytime with
     `az staticwebapp secrets list -n swa-colinshanahan-portfolio --query properties.apiKey -o tsv`)
   - **Check "Keep this value secret"**
3. Run it. The site is live at the URL from `terraform output default_hostname`
   (looks like `https://<adjective-noun-hex>.azurestaticapps.net`).

From now on, any push to `main` that touches `site/` redeploys automatically.

## Step 4 — Get a reasonable URL (custom domain)

The auto-generated `*.azurestaticapps.net` hostname is random, so for a clean URL
buy a domain — `colinshanahan.dev`, `colinshanahan.com`, or similar (~$12/yr from
Namecheap, Cloudflare, or Azure App Service Domains).

1. At your DNS provider, add a CNAME:
   `www` → `<your-swa-hostname>.azurestaticapps.net`
2. Attach it (SSL certificate is issued automatically, free):

```bash
az staticwebapp hostname set \
  -n swa-colinshanahan-portfolio \
  --hostname www.colinshanahan.dev
```

3. For the apex/root domain (`colinshanahan.dev` without `www`), use your DNS
   provider's ALIAS/ANAME/flattened-CNAME record pointing at the same hostname,
   then run the same command with the bare domain.

## Quick alternative (no pipeline, 2 minutes)

If you want it live *right now* and wire up the pipeline later:

```bash
npm install -g @azure/static-web-apps-cli
cd site
swa deploy . --env production --deployment-token "<token from Step 1>"
```

## Bonus: the "this site deploys itself" badge

Once the pipeline exists, grab its status badge (Pipelines → your pipeline →
⋮ → Status badge) and drop it in the portfolio footer linking to the pipeline —
turning your hosting into a live demo of your CI/CD work.
