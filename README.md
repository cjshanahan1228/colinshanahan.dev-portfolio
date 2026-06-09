# Deploying the portfolio: GitHub → Azure Static Web Apps

Code lives on GitHub, GitHub Actions deploys to Azure Static Web Apps in your
subscription, Terraform provisions the hosting. Cost: **$0/month** (SWA Free
tier) + ~$12/year for an optional custom domain.

```
portfolio-deploy/
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Actions: pushes /site to Static Web Apps
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

> SWA Free tier regions: `westus2`, `centralus`, `eastus2`, `westeurope`,
> `eastasia`. Default here is `eastus2`. Content is served from a global edge
> network regardless, so this only affects management metadata.

## Step 2 — Push to a GitHub repo

Create a repo at https://github.com/new — **public recommended** (the repo
itself is showcase material; just make sure nothing sensitive lands in it).

```bash
cd ..   # back to portfolio-deploy/
git init -b main
git add .
git commit -m "Portfolio site + IaC + GitHub Actions deploy"
git remote add origin https://github.com/<your-username>/portfolio.git
git push -u origin main
```

The first push triggers the workflow, which will FAIL — the secret doesn't
exist yet. That's expected; fix it in Step 3.

## Step 3 — Add the deployment token as a repo secret

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `SWA_DEPLOYMENT_TOKEN`
3. Value: the token from Step 1 (or fetch anytime with
   `az staticwebapp secrets list -n swa-colinshanahan-portfolio --query properties.apiKey -o tsv`)
4. Go to the **Actions** tab → select the failed run → **Re-run all jobs**
   (or use the "Run workflow" button on the Deploy portfolio workflow).

When it goes green, the site is live at the URL from `terraform output
default_hostname`. From now on, any push to `main` touching `site/` redeploys
automatically.

## Step 4 — Custom domain (the reasonable URL)

The auto-generated `*.azurestaticapps.net` hostname is random. For a clean URL:

1. Buy a domain (~$12/yr — Namecheap, Cloudflare, etc.)
2. Add a CNAME at your DNS provider:
   `www` → `<your-swa-hostname>.azurestaticapps.net`
3. Attach it (free auto-issued SSL):

```bash
az staticwebapp hostname set \
  -n swa-colinshanahan-portfolio \
  --hostname www.colinshanahan.dev
```

4. For the apex domain (no `www`), use an ALIAS/ANAME/flattened-CNAME record
   pointing at the same hostname, then re-run the command with the bare domain.

## Quick alternative (no Actions, 2 minutes)

```bash
npm install -g @azure/static-web-apps-cli
cd site
swa deploy . --env production --deployment-token "<token from Step 1>"
```

## Bonus: the "this site deploys itself" badge

Actions tab → Deploy portfolio workflow → ⋯ menu → **Create status badge** →
copy the markdown/URL. Drop the badge in the portfolio footer linking to the
workflow runs — live proof of your CI/CD, visible to every recruiter.
