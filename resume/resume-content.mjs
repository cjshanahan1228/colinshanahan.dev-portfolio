// The resume as data — single source of truth for the generated .docx.
// Mirrors Colin-Shanahan-Resume.pdf exactly; edit here, then run
// `npm run build` in this folder to regenerate the Word version.
//
// Rich text is expressed as an array of runs: a bare string is plain, and
// { b: "…" } is bold. That keeps the emphasis in the content rather than
// scattered through the rendering code.

export const RESUME = {
  name: "Colin Shanahan",
  contact:
    "colin.shanahan1@gmail.com | (540) 454-1170 | Rocky Mount, VA (open to relocation – Charlotte, NC) | Remote-ready",
  portfolio: {
    prefix: "Portfolio: ",
    link: { text: "colinshanahan.dev", url: "https://colinshanahan.dev" },
    suffix: " – live Azure infrastructure demo with CI/CD-powered status page and architecture docs",
  },

  summary:
    "DevOps engineer and cloud architect with 10+ years across infrastructure, systems, and cloud automation. " +
    "Sole owner of the full Azure estate at RDGFilings – CI/CD architecture, IaC (Terraform-first, with Bicep " +
    "experience), security posture, and cost governance – serving as the bridge between application teams and " +
    "infrastructure. Certified in Azure administration and DevOps (AZ-104, AZ-400) with deep experience migrating " +
    "legacy toolchains (Octopus Deploy, Jenkins) to modern, credential-free pipelines.",

  experience: [
    {
      company: "RDGFilings",
      dates: "Oct. 2022 – Present",
      title: "DevOps Engineer / Cloud Architect (sole DevOps owner)",
      location: "Remote / Onsite",
      bullets: [
        [
          "Architected Azure DevOps CI/CD pipelines end-to-end, migrating legacy workflows from ",
          { b: "Octopus Deploy" },
          " and Jenkins to Azure DevOps, reducing release cycles by 40% and improving deployment reliability.",
        ],
        [
          "Authored ",
          { b: "Terraform" },
          " (and Bicep) IaC to automate provisioning of Container Apps, Function Apps, VMs, Key Vault, and networking, replacing GCP-based systems with consistent, repeatable Azure deployments.",
        ],
        [
          "Implemented ",
          { b: "OIDC / workload identity federation" },
          " for all pipeline authentication, eliminating stored credentials and long-lived secrets from CI/CD and improving audit posture.",
        ],
        [
          "Modernized a legacy ",
          { b: "Duende IdentityServer" },
          ": programmatic ",
          { b: "Key Vault" },
          " secret loading and a shared ",
          { b: "data protection key ring" },
          " in Blob Storage encrypted with a Key Vault master key, enabling first-ever horizontal scaling – all traffic over ",
          { b: "private endpoints" },
          " with zero public data-plane exposure.",
        ],
        [
          "Served as liaison between application architects, developers, and infrastructure, translating operational requirements into DevOps processes in an Agile environment; mentored junior engineers on Azure DevOps best practices.",
        ],
        [
          "Conducted a subscription-wide ",
          { b: "Azure security and cost audit" },
          " via Resource Graph/KQL, including Reserved VM Instance retirement exposure analysis, driving remediation and cost-optimization decisions.",
        ],
        [
          "Contributed to ",
          { b: "HIPAA compliance" },
          " initiatives for a subsidiary, implementing secure configurations and documenting processes to meet regulatory standards.",
        ],
      ],
    },
    {
      company: "American Electric Power (AEP)",
      dates: "Jun. 2019 – Oct. 2022",
      title: "Infrastructure Engineer",
      location: "Roanoke, VA",
      bullets: [
        [
          "Led the onsite team managing critical restoration-focused infrastructure, including Oracle databases and Windows servers, sustaining 99.9% uptime.",
        ],
        [
          "Designed and implemented failover systems using Azure DevOps, enabling rapid recovery and minimizing downtime; documented configurations and collaborated cross-functionally on complex issues.",
        ],
      ],
    },
    {
      company: "1901 Group",
      dates: "May 2015 – Jun. 2019",
      title: "Systems Administrator / Help Desk Lead",
      location: "Blacksburg, VA / Washington, DC",
      bullets: [
        [
          "Deployed Microsoft Intune for endpoint management, streamlining device configuration and security compliance.",
        ],
        [
          "Performed networking (firewalls, DNS, switching) and served as mid-level escalation point for complex server and system issues, mentoring junior team members.",
        ],
      ],
    },
  ],

  projects: [
    [
      { b: "colinshanahan.dev" },
      " – production portfolio on Azure Static Web Apps: GitHub Actions with OIDC (zero stored credentials), Terraform IaC, and a live status page driven by an Azure Function querying Application Insights (KQL, managed identity).",
    ],
  ],

  education: {
    school: "Ferrum College",
    date: "May 2015",
    degree: "B.S. Computer Science",
    location: "Ferrum, VA",
  },

  skills: [
    [
      { b: "Certifications:" },
      " Microsoft Azure Administrator (AZ-104, 2025) • Microsoft DevOps Engineer Expert (AZ-400, 2025) • AWS Solutions Architect – Associate • AWS Certified Developer – Associate • CompTIA Security+ • ITIL Foundation",
    ],
    [
      { b: "Cloud & IaC:" },
      " Azure (Container Apps, Function Apps, Key Vault, Static Web Apps, App Insights/KQL), AWS, GCP • Terraform • Bicep • CloudFormation",
    ],
    [
      { b: "CI/CD & Tooling:" },
      " Azure DevOps, GitHub Actions, Octopus Deploy, Jenkins • OIDC/WIF • Docker • Git, Bitbucket • PowerShell • build-once/deploy-many • cost governance",
    ],
  ],
};
