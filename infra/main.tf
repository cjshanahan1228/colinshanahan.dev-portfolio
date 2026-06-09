terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
  # Recommended: store state remotely once this is in a repo.
  # backend "azurerm" {
  #   resource_group_name  = "rg-tfstate"
  #   storage_account_name = "sttfstatecolin"
  #   container_name       = "tfstate"
  #   key                  = "portfolio.tfstate"
  # }
}

provider "azurerm" {
  features {}
}

variable "location" {
  description = "Region for the Static Web App. SWA is only offered in: westus2, centralus, eastus2, westeurope, eastasia."
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

resource "azurerm_resource_group" "portfolio" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_static_web_app" "portfolio" {
  name                = var.swa_name
  resource_group_name = azurerm_resource_group.portfolio.name
  location            = azurerm_resource_group.portfolio.location

  sku_tier = "Free" # Free tier: 100 GB bandwidth/mo, custom domains, free SSL
  sku_size = "Free"
}

output "default_hostname" {
  description = "Your site URL (auto-generated subdomain on azurestaticapps.net)"
  value       = "https://${azurerm_static_web_app.portfolio.default_host_name}"
}

output "deployment_token" {
  description = "Use as the SWA_DEPLOYMENT_TOKEN secret pipeline variable"
  value       = azurerm_static_web_app.portfolio.api_key
  sensitive   = true
}
