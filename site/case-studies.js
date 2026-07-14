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
    slug: "identity-server-modernization",
    tag: "identity · secrets · scale",
    title: "Inheriting the company's identity server — and teaching it to scale",
    problem: "The service every login depends on ran as a single hand-managed instance: secrets in static files, restarts to rotate anything, and no way to scale past one replica.",
    approach: "Modernized it as a dependency chain, each step shipping alone: containerize with EF migrations, externalize secrets to Key Vault, automate rotation with a sentinel watcher, share the key ring — then scale.",
    outcome: "✓ zero-restart secret rotation · horizontally scaled · portable",
    stack: ["duende-identityserver", "asp.net-core", "docker", "ef-migrations", "key-vault", "blob-storage", "container-apps"],
    detail: {
      context:
        "Shortly after joining RDG Filings as a DevOps engineer — with little application-code experience at the time — I took ownership of the company's identity server: the Duende IdentityServer (ASP.NET Core) instance that authenticates every user of the platform. My first contributions were unglamorous: fixing dead links and pages that routed incorrectly. Ownership compounded from there over the following year.",
      diagnosis:
        "The blockers formed a dependency chain, not a list. You can't scale horizontally until every instance shares the same signing and data-protection keys. You can't rotate secrets safely until configuration is externalized. And you can't deploy repeatably until the app and its schema are self-contained. That ordering became the roadmap — portable, then externalized secrets, then rotation, then a shared key ring, and scaling falls out at the end. Each step shipped on its own, so the service got safer every month instead of waiting on a big-bang rewrite.",
      fix:
        "<p><strong>Portability first.</strong> Dockerized the service and moved schema management into EF Core migrations, so a fresh environment stands up from the repo alone. It became one of the first workloads in the Azure Container Apps environment I'd built for the company — a story of its own.</p>" +
        "<p><strong>Secrets next.</strong> Wired Azure Key Vault in as a configuration source: connection strings and private settings load dynamically at runtime, and nothing sensitive lives in files or app settings.</p>" +
        "<p><strong>Then rotation.</strong> A sentinel watcher monitors Key Vault for value changes and reloads configuration on a 24-hour cycle or an on-demand trigger — secrets rotate with zero restarts and zero login interruptions.</p>" +
        "<p><strong>Finally, the key ring.</strong> We held a Duende license but weren't using its key management. I persisted the key ring to Azure Blob Storage, protected through the same Key Vault, so every replica shares the same signing and data-protection keys — which unlocked running more than one replica at all.</p>",
      impact:
        "The company's front door went from a fragile single-instance pet to a portable, horizontally scaled service. Secret rotation is now a Key Vault write instead of a config edit and a restart; environments are reproducible from code; login capacity is no longer pinned to one instance. Ownership also means continuous hardening — dependency currency and configuration tightening as a standing duty, not an afterthought. And it reshaped my role: the engineer who started by fixing dead links ended up owning the authentication platform.",
      lessons: [
        "Modernization is a dependency chain — sequence it so every step ships value on its own: portable → externalized config → rotation → shared keys → scale.",
        "Externalize configuration early; almost everything you want to do later depends on it.",
        "Read what your vendor already sold you — the licensed key-management feature that unlocked scaling was sitting unused.",
        "Inexperience isn't a blocker to ownership; owning a production service is the fastest way to stop being inexperienced.",
      ],
    },
  },
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
