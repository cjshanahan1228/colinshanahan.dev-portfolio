// ═══════════════════ ADDING A CASE STUDY ═══════════════════
// One object per study. The homepage card grid and /case-studies
// both render from this file — add an entry, open a PR, done. The deploy
// workflow pre-renders them into static HTML (no JS needed to read them).
//
// SANITIZATION RULES — every entry must pass all six:
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
//   6. Deep detail never names the employer. Resume-level claims
//      (what the resume already says) may carry a name; a diagnosis
//      narrative is always just "the company".
//
// Fields: slug/tag/title/problem/approach/outcome/stack are required
// and drive the homepage card. `detail` is the full writeup (set null
// until written): { context, diagnosis, fix, impact, postscript?, lessons[] }.
// `postscript` is optional HTML rendered right after Impact — use it for
// where the ecosystem stands now. It must read as awareness, never as a
// claim of experience with anything not listed in `stack`.
// ═════════════════════════════════════════════════════════════

window.CASE_STUDIES = [
  {
    slug: "identity-server-modernization",
    tag: "identity · secrets · scale",
    title: "Inheriting the company's identity server — and teaching it to scale",
    problem: "Every login ran through one hand-managed, end-of-support IdentityServer4 instance: secrets in local config files, a restart to rotate anything, and no way to scale past a single replica.",
    approach: "Moved it to Duende and modernized in shippable steps — containerize with EF migrations, externalize secrets to Key Vault, automate rotation, share the signing key ring — proving each cutover before trusting it.",
    outcome: "✓ sessions survive deploys · zero-restart rotation · horizontally scaled",
    stack: ["duende-identityserver", "asp.net-core", "docker", "ef-migrations", "key-vault", "blob-storage", "container-apps"],
    detail: {
      context:
        "<p>Every platform has a front door: the identity server. It's the service that handles every login — checking credentials and issuing the tokens that prove to every other system who you are. When it's down, nobody gets in. Ours was an IdentityServer4 (ASP.NET Core) instance approaching end of support, and the move to its successor, Duende IdentityServer, had no owner.</p>" +
        "<p>The engineers who knew the service were stretched across other priorities, so it needed a new owner — and the team put it in my hands. Not because I was the most experienced; I had little application-code experience at the time. Because I was the engineer they trusted to take care of it. That trust set the bar. My first contributions were unglamorous — fixing dead links and broken routing — and what followed was a year of Duende documentation, trial and error in local and dev environments, and progressively bigger swings at the service every login depends on.</p>",
      diagnosis:
        "<p>Two things made the risk concrete. Secrets handling predated centralized tooling — connection strings and client secrets lived in local configuration files, which bothered me before anything else did. And when clients depend on the platform to meet hard external deadlines, identity downtime doesn't just pause work — it costs trust, and the repeat business that trust brings.</p>" +
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
      postscript:
        "<p>The ecosystem has moved since I shipped this. Duende archived the IdentityServer4 repository read-only (announced March 2025). In 2026, Rock Solid Knowledge forked that Apache-2.0 codebase into Open.IdentityServer — independently maintained and free, with documented migration paths from both IdentityServer4 and Duende, and explicitly not affiliated with or endorsed by Duende. Duende's own line went the other way: source-available under a paid production license, free only below a revenue threshold, and now at v8 (June 2026). This is ecosystem awareness, not experience — I haven't run Open.IdentityServer, and the stack listed here is what I actually ran.</p>" +
        "<p>Two things I'd take from that. <strong>Licensing is an architectural constraint, not a procurement footnote.</strong> The capability that finally unlocked horizontal scaling was key management we already owned and hadn't switched on. On a free fork, that's the first thing I'd verify rather than assume — the whole scaling story depends on every replica agreeing about signing keys. <strong>And almost none of the work was vendor-specific.</strong> Containerizing, externalizing configuration, rotating without restarts, and persisting a shared key ring are properties of the system, not the SDK — which is the real test of whether the modernization was sequenced correctly.</p>",
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
    problem: "Releases ran through Octopus Deploy and a self-hosted Jenkins server, and they were unreliable and hectic — many deploys only succeeded after manual server edits — with a pricey license renewal on the way.",
    approach: "Rebuilt roughly 25 pipelines in Azure DevOps pipeline by pipeline where possible: consistent YAML builds with path-based triggers for the monorepo, and classic release pipelines with an environment per app, approvals on every release, and environment-specific variable groups.",
    outcome: "✓ release cycles −40% · reliability up · one platform",
    stack: ["azure-devops", "yaml-pipelines", "classic-releases", "artifact-feeds", "octopus-deploy", "jenkins"],
    detail: {
      context:
        "<p>The company had recently moved from GCP to Azure and wanted to stay inside the Microsoft ecosystem, which made Azure DevOps the logical home for build and deploy. At the same time, the Octopus Deploy license renewal was coming up with a significant price increase — a natural moment to ask whether we should keep paying for a tool the team already had reasons to distrust.</p>" +
        "<p>And we did have reasons. My experience with Octopus there was that deployments were unreliable and hectic: many of them only succeeded after someone made manual edits or changes on the servers. Release day was something you got through, not something you could count on.</p>",
      diagnosis:
        "<p>Before replacing anything, I wanted to know why deploys were so fragile, because migrating the same fragility onto a new tool would have been a waste. A few causes kept showing up:</p>" +
        "<p><strong>Artifacts were sometimes missing files,</strong> so a deploy could fail — or half-work — because of what was (or wasn't) in the package. <strong>Variable and configuration management in Octopus was poorly set up,</strong> which is a large part of why servers needed hand edits to get a release over the line. <strong>Environments weren't enforced to match production,</strong> so non-prod didn't deploy the way prod did and a passing test deploy proved less than it should have. And <strong>there were no approval gates:</strong> in practice nobody explicitly signed off before a release went out.</p>" +
        "<p>None of those are really tool problems. They're discipline problems the old setup made easy to skip — which shaped the goal. It wasn't “the same thing, hosted somewhere else”; it was a setup where the safe path is the default one.</p>",
      fix:
        "<p><strong>One pipeline at a time, where possible.</strong> There were roughly 25 pipelines in total, across Gradle, .NET and other stacks. Migrating them pipeline by pipeline meant each cutover was small enough to reason about, instead of one big switch on release day.</p>" +
        "<p><strong>The monorepo was the hard part.</strong> One repository held multiple projects, so a build pipeline couldn't simply fire on every commit. The Azure DevOps YAML build pipelines use path-based triggers pointing at the right project folders, so a change to one project builds that project and not its neighbors.</p>" +
        "<p><strong>Builds: YAML, same shape every time.</strong> Every build pipeline follows a consistent structure, so once you've read one you can read them all — and so a problem in one place is easy to compare against a working one.</p>" +
        "<p><strong>Releases: classic release pipelines, with the guardrails built in.</strong> Each app got its own deployment environment. Approvals are configured on every release pipeline, so the explicit sign-off that was missing before is now part of the path rather than something to remember. Build and release variables moved into environment-specific variable groups, so configuration lives in one visible place per environment instead of in hand edits on servers — and non-prod deploys go through the same mechanics as prod.</p>" +
        "<p><strong>The part that took real work: leaving self-hosted Jenkins.</strong> Moving to Microsoft-hosted agents changed how builds produce and pass variables and artifacts, so I couldn't lift the old steps over as-is. I had to create artifact feeds, and work out the correct build steps and configuration for hosted agents — in effect rethinking how each build hands its output to the release.</p>",
      impact:
        "<p>The cutover went well — which, for a change to how everything ships, was the outcome that mattered most. Release consistency improved dramatically: the manual server edits that used to decide whether a deploy worked gave way to the same pipeline and the same variables each time. Management was happy with the better visibility into the CI/CD process.</p>" +
        "<p>The new approvals and audit trail also helped get the company's SOC audits completed. And the company avoided the Octopus Deploy renewal at the higher price, while consolidating build and deploy on the platform it was already standardizing on.</p>",
      lessons: [
        "Diagnose why the old system was fragile before you replace it — otherwise you just migrate the fragility.",
        "Migrate in slices you can reason about: pipeline by pipeline beats a single switch on release day.",
        "Make the safe path the default one: approvals and per-environment variable groups built into every pipeline, not left to memory.",
        "A consistent pipeline structure is a feature — it makes each one easier to read, review and debug.",
        "Moving from a self-hosted server to hosted agents is a change in how builds pass data, not just where they run — budget for rethinking artifacts and variables.",
      ],
    },
  },
  {
    slug: "gcp-to-azure-iac",
    tag: "iac · cloud migration",
    title: "Replacing hand-built GCP systems with Terraform on Azure",
    problem: "The company's GCP estate had been stood up quickly by previous staff with no planning, organization, or documentation — Windows VMs hosting IIS sites, VMs running SQL databases, a simple load balancer — and nobody could say what was needed and what wasn't.",
    approach: "Reverse-engineered what was running, then rebuilt it on Azure with documentation and environments in mind from the start: a coherent network scheme, an Application Gateway built in Terraform first, and SQL moved to Azure SQL elastic pools — cut over in stages.",
    outcome: "✓ pretty seamless migration · no significant downtime on main sites · documented, version-controlled infra",
    stack: ["terraform", "application-gateway", "azure-sql", "elastic-pools", "gcp"],
    detail: {
      context:
        "<p>The move from GCP to Azure was driven mostly by upper management wanting the company in the Microsoft ecosystem.</p>" +
        "<p>The harder problem was what we were moving. Previous staff had stood up VMs and other cloud pieces quickly, with no planning, no organization, and no documentation. There was no inventory to migrate from — which meant it was hard to know what was actually needed and what wasn't.</p>",
      diagnosis:
        "<p>What existed on GCP was, on paper, simple: VMs running SQL databases, Windows VMs hosting IIS sites, a basic load balancing setup, and the networking holding it together. What it did, and why, was written down nowhere.</p>" +
        "<p>So the first phase was archaeology. It took months of searching through the VMs and their configuration and reading the code to work out where everything was and what it did. With no documentation to lean on, the machines and the code were the only source of truth.</p>" +
        "<p>That shaped the goal. Lifting the estate across as-is would have carried the mystery with it. The aim was to end up with something a person could understand without having to repeat the archaeology: a clearly documented, easy-to-follow site map, where every change can be tracked.</p>",
      fix:
        "<p><strong>Documentation and environments from day one.</strong> On Azure I designed with both in mind from the start, rather than trying to retrofit them later — the exact thing that had gone missing on GCP.</p>" +
        "<p><strong>A network scheme that made sense.</strong> Rather than carrying the old networking across, I laid out a scheme that made sense, so it was possible to explain where things lived and how traffic moved between them.</p>" +
        "<p><strong>An Application Gateway, built in Terraform first.</strong> The sites were fronted by an Azure Application Gateway with multiple backend pools and path-based routing, replacing the simple load balancing setup. I built it in Terraform first, so the infrastructure was defined as code in version control from the start. The payoff is the site map: how requests are routed is readable in the code, and changes to it show up as reviewable, trackable diffs rather than as someone's memory of a portal click.</p>" +
        "<p><strong>SQL onto Azure SQL.</strong> The SQL servers that had been running on VMs moved to Azure SQL, using elastic pools.</p>" +
        "<p><strong>Cutover in stages.</strong> Rather than switching everything at once, we moved the VMs first, then did the database work as one large migration. Staging it kept each piece of the move smaller and easier to reason about.</p>" +
        "<p>The move to Azure DevOps that followed is its own writeup.</p>",
      impact:
        "<p>The migration was pretty seamless: users did not experience significant downtime on the main sites. For a move that touched the VMs, the front door, and the databases, that was the outcome that mattered most.</p>" +
        "<p>What we ended up with is also easier to live with than what we left. The infrastructure is defined in version-controlled Terraform, and the goal throughout was a clearly documented, easy-to-understand site map with trackable changes — something the next person can read instead of reconstruct.</p>",
      lessons: [
        "Budget for discovery. With no documentation, understanding the old estate was most of the work — and it took months.",
        "Don't migrate a mystery. Work out what's needed before rebuilding, so you aren't carrying pieces across just because they exist.",
        "Build documentation and environments in from the start; they're far harder to add after the fact.",
        "Write infrastructure in code first. Version control makes every change trackable and the site map something you can read.",
        "Cut over in stages — VMs first, then the one big database migration — so each step stays small enough to reason about.",
      ],
    },
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
