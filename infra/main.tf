terraform {
  required_version = ">= 1.5"

  # State rides in the same storage account the resume/table use — deliberate
  # reuse for a solo project. Consequence: never `terraform destroy` this
  # config wholesale; the state's own container is inside it.
  backend "azurerm" {
    resource_group_name  = "rg-portfolio"
    storage_account_name = "stcolinshanahanresume"
    container_name       = "tfstate"
    key                  = "portfolio.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.7"
    }
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_client_config" "current" {}

variable "location" {
  description = "SWA Free tier regions: westus2, centralus, eastus2, westeurope, eastasia."
  type        = string
  default     = "eastus2"
}

variable "resource_group_name" {
  type    = string
  default = "rg-portfolio"
}

variable "swa_name" {
  type    = string
  default = "swa-colinshanahan-portfolio"
}

variable "storage_account_name" {
  description = "Globally unique. If taken, change here AND in .github/workflows/deploy.yml."
  type        = string
  default     = "stcolinshanahanresume"
}

variable "owner_email" {
  description = "Where resume requests are sent for approval."
  type        = string
  default     = "Colin.shanahan1@gmail.com"
}

variable "admin_github_login" {
  description = "GitHub login allowed to read /admin. The `authenticated` role alone is any GitHub user, so the API checks this too."
  type        = string
  default     = "cjshanahan1228"
}

variable "site_base_url" {
  description = "Public origin of the site — approve/deny links in notification emails point here."
  type        = string
  default     = "https://www.colinshanahan.dev"
}

variable "github_repo" {
  description = "owner/repo allowed to deploy via OIDC. Renaming the repo requires re-apply."
  type        = string
  default     = "cjshanahan1228/colinshanahan.dev-portfolio"
}

resource "azurerm_resource_group" "portfolio" {
  name     = var.resource_group_name
  location = var.location
}

# ── Hosting ────────────────────────────────────────────────────────────────
resource "azurerm_static_web_app" "portfolio" {
  name                = var.swa_name
  resource_group_name = azurerm_resource_group.portfolio.name
  location            = azurerm_resource_group.portfolio.location
  sku_tier            = "Free"
  sku_size            = "Free"

  # Consumed by the managed API (site/../api) — resume request/approval flow.
  app_settings = {
    RESUME_STORAGE_ACCOUNT = azurerm_storage_account.resume.name
    RESUME_STORAGE_KEY     = azurerm_storage_account.resume.primary_access_key
    RESUME_TABLE           = azurerm_storage_table.resume_requests.name
    ACS_CONNECTION_STRING  = azurerm_communication_service.portfolio.primary_connection_string
    EMAIL_SENDER           = "DoNotReply@${azurerm_email_communication_service_domain.portfolio.mail_from_sender_domain}"
    OWNER_EMAIL            = var.owner_email
    SITE_BASE_URL          = var.site_base_url
    ADMIN_GITHUB_LOGIN     = var.admin_github_login
  }

  # The deployment token (api_key) is used from CI, and Azure links the SWA to
  # this GitHub repo when it deploys. The provider can't manage that link
  # (repository_token is unreadable), so don't let Terraform try to null it.
  # See the azurerm_static_web_app docs note on api_key deployments.
  lifecycle {
    ignore_changes = [repository_url, repository_branch]
  }
}

# ── Resume storage ─────────────────────────────────────────────────────────
resource "azurerm_storage_account" "resume" {
  name                             = var.storage_account_name
  resource_group_name              = azurerm_resource_group.portfolio.name
  location                         = azurerm_resource_group.portfolio.location
  account_tier                     = "Standard"
  account_replication_type         = "LRS"
  https_traffic_only_enabled       = true
  min_tls_version                  = "TLS1_2"
  allow_nested_items_to_be_public  = false # gated: access only via approval-issued SAS links
  cross_tenant_replication_enabled = false

  # Shared-key access stays on deliberately: the managed (Free-tier) SWA API has
  # no managed identity, so it authenticates to Table Storage and signs SAS
  # links with the account key. Treat that key as the crown jewel — rotate it on
  # any suspicion, and prefer moving tfstate to its own account.

  # SAS hygiene: approval links live 7 days (+5 min clock-skew allowance). Log
  # (don't block) anything issued with a longer lifetime.
  sas_policy {
    expiration_period = "07.00:05:00"
    expiration_action = "Log"
  }

  blob_properties {
    versioning_enabled = true # tfstate lives here too — versioning is the rollback story

    # Soft delete: a deleted blob or container (tfstate, resume) is recoverable.
    delete_retention_policy {
      days = 14
    }
    container_delete_retention_policy {
      days = 14
    }
  }

  # This account also holds the Terraform state; losing it loses the state.
  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "resume" {
  name                  = "resume"
  storage_account_id    = azurerm_storage_account.resume.id
  container_access_type = "private"
}

# Resume request queue: one entity per visitor request (pending/approved/denied).
resource "azurerm_storage_table" "resume_requests" {
  name               = "resumerequests"
  storage_account_id = azurerm_storage_account.resume.id
}

# ── Resume request emails: Azure Communication Services ────────────────────
# Azure-managed sender domain — zero DNS setup; sender is
# DoNotReply@<guid>.azurecomm.net. Pay-per-message (fractions of a cent).
resource "azurerm_email_communication_service" "portfolio" {
  name                = "acs-email-colinshanahan"
  resource_group_name = azurerm_resource_group.portfolio.name
  data_location       = "United States"
}

resource "azurerm_email_communication_service_domain" "portfolio" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.portfolio.id
  domain_management = "AzureManaged"
}

resource "azurerm_communication_service" "portfolio" {
  name                = "acs-colinshanahan-portfolio"
  resource_group_name = azurerm_resource_group.portfolio.name
  data_location       = "United States"
}

resource "azurerm_communication_service_email_domain_association" "portfolio" {
  communication_service_id = azurerm_communication_service.portfolio.id
  email_service_domain_id  = azurerm_email_communication_service_domain.portfolio.id
}

# ── GitHub Actions → Azure via OIDC (no stored cloud secrets) ──────────────
resource "azurerm_user_assigned_identity" "github" {
  name                = "id-github-portfolio-deploy"
  resource_group_name = azurerm_resource_group.portfolio.name
  location            = azurerm_resource_group.portfolio.location
}

resource "azurerm_federated_identity_credential" "github_main" {
  name                      = "github-main-branch"
  user_assigned_identity_id = azurerm_user_assigned_identity.github.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = "https://token.actions.githubusercontent.com"
  subject                   = "repo:${var.github_repo}:ref:refs/heads/main"
}

# Scoped to the resume CONTAINER, not the storage account: the same account
# holds the Terraform state (tfstate container, which contains every secret in
# this config), and the CI identity must not be able to read or overwrite it.
resource "azurerm_role_assignment" "github_blob_writer" {
  scope                = "${azurerm_storage_account.resume.id}/blobServices/default/containers/${azurerm_storage_container.resume.name}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}

# ── Visitor analytics: browser Application Insights ────────────────────────
# A SEPARATE component from the status project's appi-colinshanahan-dev (which
# lives in cjshanahan1228/portfolio-status), on the same Log Analytics
# workspace. Why not reuse that one:
#   * The browser SDK ships the connection string (ingestion key) to every
#     visitor. On the shared component, anyone holding it could post fake
#     availabilityResults and move the uptime the /status page reports.
#   * A daily cap on the shared component would also cut off the availability
#     data the status page queries once web traffic hit the cap.
#   * Page views stay out of the status page's KQL entirely (it queries its
#     own component via queryResource), so nothing there changes.
# Same workspace = one place to query, one retention setting, one bill line.
variable "analytics_workspace_name" {
  description = "Existing Log Analytics workspace (managed by the portfolio-status repo) that the browser telemetry is stored in."
  type        = string
  default     = "log-portfolio-status"
}

variable "analytics_workspace_resource_group" {
  description = "Resource group of analytics_workspace_name. Must be in the same subscription as this config."
  type        = string
  default     = "rg-portfolio-status"
}

variable "analytics_daily_cap_gb" {
  description = "Daily ingestion cap for browser telemetry. A portfolio's real traffic is a few MB/day; the cap only matters if the public key is abused. 0.1 GB/day x 31 days stays under the free 5 GB/month."
  type        = number
  default     = 0.1
}

data "azurerm_log_analytics_workspace" "telemetry" {
  name                = var.analytics_workspace_name
  resource_group_name = var.analytics_workspace_resource_group
}

resource "azurerm_application_insights" "web" {
  name                = "appi-colinshanahan-web"
  resource_group_name = azurerm_resource_group.portfolio.name
  # Same region as the workspace it writes to; this also fixes the region in
  # the connection string's IngestionEndpoint (<region>-N.in.applicationinsights.azure.com).
  location         = data.azurerm_log_analytics_workspace.telemetry.location
  workspace_id     = data.azurerm_log_analytics_workspace.telemetry.id
  application_type = "web"

  # Matches the workspace (30 days), so nothing is kept longer than the
  # availability data already is.
  retention_in_days                    = 30
  daily_data_cap_in_gb                 = var.analytics_daily_cap_gb
  daily_data_cap_notifications_enabled = true
  sampling_percentage                  = 100

  # The browser SDK authenticates with the ingestion key in the connection
  # string; there is no Entra ID option for anonymous browsers, so local auth
  # must stay ON for this component. The key can only WRITE telemetry here.
  local_authentication_enabled = true
  internet_ingestion_enabled   = true
  internet_query_enabled       = true

  # Keep Azure's default: the client IP is used for country/city lookup and
  # then zeroed (0.0.0.0) before it is stored.
  ip_masking_enabled = true
}

# ── Outputs ────────────────────────────────────────────────────────────────
output "default_hostname" {
  value = "https://${azurerm_static_web_app.portfolio.default_host_name}"
}

output "deployment_token" {
  description = "GitHub secret: SWA_DEPLOYMENT_TOKEN"
  value       = azurerm_static_web_app.portfolio.api_key
  sensitive   = true
}

output "resume_blob_endpoint" {
  description = "Private — resumes are reachable only via SAS links issued on approval."
  value       = "${azurerm_storage_account.resume.primary_blob_endpoint}resume/"
}

output "azure_client_id" {
  description = "GitHub variable: AZURE_CLIENT_ID"
  value       = azurerm_user_assigned_identity.github.client_id
}

output "azure_tenant_id" {
  description = "GitHub variable: AZURE_TENANT_ID"
  value       = data.azurerm_client_config.current.tenant_id
}

output "azure_subscription_id" {
  description = "GitHub variable: AZURE_SUBSCRIPTION_ID"
  value       = data.azurerm_client_config.current.subscription_id
}

output "appinsights_web_connection_string" {
  description = "GitHub repository VARIABLE (not secret): APPINSIGHTS_CONNECTION_STRING. Public by design: it ships to every browser. Read with: terraform output -raw appinsights_web_connection_string"
  value       = azurerm_application_insights.web.connection_string
  sensitive   = true # the provider marks it sensitive; it is not a secret in practice
}

output "appinsights_web_ingestion_origin" {
  description = "Ingestion origin the browser SDK posts to. Covered by connect-src https://*.in.applicationinsights.azure.com in site/staticwebapp.config.json; can be pinned to this exact origin in a follow-up."
  value       = nonsensitive(regex("IngestionEndpoint=(https://[^/;]+)", azurerm_application_insights.web.connection_string)[0])
}
