terraform {
  required_version = ">= 1.5"
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
  description = "Region for the Static Web App. SWA Free tier regions: westus2, centralus, eastus2, westeurope, eastasia."
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
  description = "Globally unique, 3-24 lowercase alphanumeric. If taken, change here AND in the site's resume URLs."
  type        = string
  default     = "stcolinshanahanresume"
}

variable "github_repo" {
  description = "owner/repo allowed to deploy via OIDC. If you rename the repo, update this and re-apply."
  type        = string
  default     = "cjshanahan1228/portfolio-project-alpha"
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

  sku_tier = "Free"
  sku_size = "Free"
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
  allow_nested_items_to_be_public = true # container below is public-read by design
}

resource "azurerm_storage_container" "resume" {
  name                  = "resume"
  storage_account_id    = azurerm_storage_account.resume.id
  container_access_type = "blob" # anonymous read on blobs only — it's a public resume
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

# Identity may only write blobs in the resume account — least privilege.
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

output "resume_pdf_url" {
  value = "${azurerm_storage_account.resume.primary_blob_endpoint}resume/Colin-Shanahan-Resume.pdf"
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
