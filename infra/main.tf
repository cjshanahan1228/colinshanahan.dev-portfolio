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
      version = "~> 4.0"
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
}

# ── Resume storage ─────────────────────────────────────────────────────────
resource "azurerm_storage_account" "resume" {
  name                            = var.storage_account_name
  resource_group_name             = azurerm_resource_group.portfolio.name
  location                        = azurerm_resource_group.portfolio.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  https_traffic_only_enabled      = true
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false # gated: access only via approval-issued SAS links

  blob_properties {
    versioning_enabled = true # tfstate lives here too — versioning is the rollback story
  }
}

resource "azurerm_storage_container" "resume" {
  name                  = "resume"
  storage_account_id    = azurerm_storage_account.resume.id
  container_access_type = "private"
}

# Resume request queue: one entity per visitor request (pending/approved/denied).
resource "azurerm_storage_table" "resume_requests" {
  name                 = "resumerequests"
  storage_account_name = azurerm_storage_account.resume.name
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
  name                = "github-main-branch"
  resource_group_name = azurerm_resource_group.portfolio.name
  parent_id           = azurerm_user_assigned_identity.github.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = "repo:${var.github_repo}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "github_blob_writer" {
  scope                = azurerm_storage_account.resume.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
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
