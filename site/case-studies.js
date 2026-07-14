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
    problem: "Every login ran through one hand-managed, end-of-support IdentityServer4 instance: secrets in plaintext config files, a restart to rotate anything, and no way to scale past a single replica.",
    approach: "Moved it to Duende and modernized in shippable steps — containerize with EF migrations, externalize secrets to Key Vault, automate rotation, share the signing key ring — proving each cutover before trusting it.",
    outcome: "✓ sessions survive deploys · zero-restart rotation · horizontally scaled",
    stack: ["duende-identityserver", "asp.net-core", "docker", "ef-migrations", "key-vault", "blob-storage", "container-apps"],
    detail: {
      context:
        "<p>Shortly after I joined RDG Filings as a DevOps engineer, the company's identity server needed an owner. It ran IdentityServer4, which was approaching end of support, and the engineers who knew it had no bandwidth — so despite having little application-code experience at the time, I took it on out of necessity. My first contributions were unglamorous: fixing dead links and pages that routed incorrectly.</p>" +
        "<p>What followed was a year of Duende documentation, trial and error in local and dev environments, and progressively bigger swings at the service every user of the platform logs in through.</p>",
      diagnosis:
        "<p>Two things made the risk concrete. Client secrets and connection strings sat in plaintext appsettings files — that bothered me before anything else did. And in a regulatory-filing business, deadline windows are unforgiving: identity downtime during one doesn't just pause work, it costs clients and the trust that brings them back.</p>" +
        "<p>The blockers formed a dependency chain, not a list. You can't scale horizontally until every replica signs tokens with the same keys. You can't rotate secrets safely until configuration is externalized. You can't deploy repeatably until the app and its schema are self-contained. That ordering became the roadmap — portability, then secrets, then rotation, then the key ring — with each step shipping on its own instead of waiting on a big-bang rewrite.</p>",
      fix:
        "<p><strong>Portability first (about a week).</strong> Dockerized the service, with EF Core migrations standing up the new Duende configuration database from code, so a fresh environment builds from the repo alone. It became one of the first workloads in the Azure Container Apps environment I'd built for the company — a story of its own.</p>" +
        "<p><strong>Secrets next (about a month), including a self-inflicted lesson.</strong> I wired Azure Key Vault in as a runtime configuration source via the Azure.Extensions provider — and my first pass loaded secrets by number: 1-secret, 2-secret. It worked, and it was poor planning: rotating anything meant remembering which number belonged to which client. I redid the scheme around client-based names (clientname-secret), so a human can read the vault and know what everything is.</p>" +
        "<p><strong>Then rotation.</strong> A sentinel watcher monitors Key Vault for value changes and reloads configuration every 24 hours or on a manual trigger — secrets rotate with zero restarts.</p>" +
        "<p><strong>The cutover was the scary part.</strong> Every client had to resolve the right secret on the first production load. So I built a throwaway verification page — restricted to the team, local and QA environments only, never deployed to production — showing each client against the secret it resolved. We verified the mapping by eye before trusting the cutover, instead of hoping.</p>" +
        "<p><strong>Finally, the signing key ring (a couple of months).</strong> We held a Duende license but weren't using its key management, so token signing was pinned to a single instance. I persisted the key ring to Azure Blob Storage, protected through the existing Key Vault — and hit the best bug of the project: replicas were publishing different <code>kid</code> values in their JWKS documents, so a token signed by one instance failed validation on another. The culprit was a local-development setting that had leaked into server configuration; the fix drives the active key from a database field so every replica agrees.</p>" +
        "<p><strong>Proof, not vibes.</strong> I split Container Apps traffic 50/50 across two replicas and watched real logins land on both in the logs — sessions intact, tokens validating everywhere — before calling horizontal scaling done.</p>",
      impact:
        "The company's front door went from a fragile single-instance pet to a portable, horizontally scaled service — and the change users actually feel is the one nobody sees: deploys, reboots, and scale events no longer end sessions, so nobody gets logged out because we shipped. Secret rotation is a Key Vault write instead of a config edit and a restart. Environments rebuild from code. Ownership also means continuous hardening — dependency currency and configuration tightening as a standing duty, not an afterthought. And it reshaped my role: the engineer who started by fixing dead links ended up owning the authentication platform.",
      lessons: [
        "Name things for the person doing the 2 a.m. rotation — numbered secrets “worked” and were still wrong.",
        "Prove cutovers with your own eyes: throwaway verification tooling and a 50/50 traffic split beat hoping.",
        "Sequence modernization as a dependency chain so every step ships value alone: portable → externalized config → rotation → shared keys → scale.",
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
