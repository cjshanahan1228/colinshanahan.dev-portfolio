// ═══════════════════ ADDING A CASE STUDY ═══════════════════
// One object per study. The homepage card grid and /case-studies
// both render from this file — add an entry, open a PR, done.
//
// SANITIZATION RULES — every entry must pass all five:
//   1. No internal system names, hostnames, repo names, or vendor
//      contracts. Describe the CLASS of system: "a nightly
//      document-processing pipeline", not what it's really called.
//   2. No customer names, dollar figures, or confidential scale
//      numbers. Relative metrics only: "~60% faster", "a weekly
//      manual step eliminated".
//   3. Nothing security-shaped about an employer — no vulns,
//      compliance gaps, or incident details, even anonymized.
//   4. The reasoning is the content. Write what YOU observed,
//      decided, and learned — that part of the story is yours.
//   5. Litmus test: comfortable if your manager and their legal
//      team read it with your name on it? They can — it's public.
//
// Fields: slug/tag/title/problem/approach/outcome/stack are required
// and drive the homepage card. `detail` is the full writeup (set null
// until written): { context, diagnosis, fix, impact, lessons[] }.
// ═════════════════════════════════════════════════════════════

window.CASE_STUDIES = [
  {
    slug: "azure-devops-migration",
    tag: "migration · ci/cd",
    title: "Retiring Octopus Deploy & Jenkins without breaking release day",
    problem: "Two legacy deployment systems, fragmented release knowledge, and slow, unreliable release cycles.",
    approach: "Rebuilt the workflows as Azure DevOps multi-stage YAML pipelines, migrating incrementally so teams never lost the ability to ship while cutting over.",
    outcome: "✓ release cycles −40% · reliability up · one platform",
    stack: ["azure-devops", "yaml-pipelines", "octopus-deploy", "jenkins"],
    detail: null,
  },
  {
    slug: "gcp-to-azure-iac",
    tag: "iac · cloud migration",
    title: "Replacing hand-built GCP systems with Terraform & Bicep on Azure",
    problem: "Infrastructure provisioned by hand on GCP — inconsistent environments, no repeatable path from dev to production.",
    approach: "Codified the estate in Terraform and Bicep: Container Apps, Function Apps, VMs, and Key Vault, provisioned identically every time from version-controlled templates.",
    outcome: "✓ repeatable environments · drift eliminated · auditable infra",
    stack: ["terraform", "bicep", "container-apps", "key-vault"],
    detail: null,
  },
  {
    slug: "restoration-failover",
    tag: "reliability · failover",
    title: "Failover for the systems that turn the lights back on",
    problem: "At AEP, restoration-focused applications backed by Oracle and Windows servers couldn't afford downtime — these are the systems crews depend on during outages.",
    approach: "Designed and implemented failover systems orchestrated through Azure DevOps, enabling rapid, practiced recovery instead of ad-hoc heroics.",
    outcome: "✓ 99.9% uptime sustained · rapid recovery during outages",
    stack: ["azure-devops", "oracle", "windows-server", "failover"],
    detail: null,
  },
];
