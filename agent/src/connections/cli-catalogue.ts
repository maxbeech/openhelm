import type { CliCatalogEntry } from "@openhelm/shared";

/** Hard-coded catalogue of official 1st-party CLIs */
export function getCliCatalogue(): CliCatalogEntry[] {
  return [
    {
      id: "gh",
      name: "GitHub CLI",
      description: "Official GitHub CLI — create PRs, manage repos, and more",
      packageManager: "preinstalled",
      installCommand: ["brew", "install", "gh"],
      authFilePaths: ["~/.config/gh/hosts.yml", "~/.config/gh/config.yml"],
      authCommand: ["gh", "auth", "login", "--web"],
    },
    {
      id: "supabase",
      name: "Supabase CLI",
      description: "Official Supabase CLI — manage projects, run migrations",
      packageManager: "npm",
      installCommand: ["npm", "install", "-g", "supabase"],
      authFilePaths: ["~/.supabase/access-token"],
      authCommand: ["supabase", "login"],
    },
    {
      id: "vercel",
      name: "Vercel CLI",
      description: "Official Vercel CLI — deploy and manage Vercel projects",
      packageManager: "npm",
      installCommand: ["npm", "install", "-g", "vercel"],
      authFilePaths: ["~/.local/share/com.vercel.cli/auth.json"],
      authCommand: ["vercel", "login"],
    },
    {
      id: "aws",
      name: "AWS CLI",
      description: "Official AWS CLI v2 — manage AWS services",
      packageManager: "curl",
      installCommand: ["brew", "install", "awscli"],
      authFilePaths: ["~/.aws/credentials", "~/.aws/config"],
      authCommand: ["aws", "configure"],
    },
    {
      id: "gcloud",
      name: "Google Cloud CLI",
      description: "Official Google Cloud CLI — manage GCP resources",
      packageManager: "curl",
      installCommand: ["brew", "install", "--cask", "google-cloud-sdk"],
      authFilePaths: ["~/.config/gcloud/credentials.db", "~/.config/gcloud/application_default_credentials.json"],
      authCommand: ["gcloud", "auth", "login"],
    },
    {
      id: "stripe",
      name: "Stripe CLI",
      description: "Official Stripe CLI — manage Stripe integration and webhooks",
      packageManager: "brew",
      installCommand: ["brew", "install", "stripe/stripe-cli/stripe"],
      authFilePaths: ["~/.config/stripe/config.toml"],
      authCommand: ["stripe", "login"],
    },
    {
      id: "fly",
      name: "Fly.io CLI",
      description: "Official Fly.io CLI (flyctl) — deploy apps to Fly.io",
      packageManager: "curl",
      installCommand: ["brew", "install", "flyctl"],
      authFilePaths: ["~/.fly/config.yml"],
      authCommand: ["fly", "auth", "login"],
    },
    {
      id: "railway",
      name: "Railway CLI",
      description: "Official Railway CLI — deploy and manage Railway projects",
      packageManager: "npm",
      installCommand: ["npm", "install", "-g", "@railway/cli"],
      authFilePaths: ["~/.railway/config.json"],
      authCommand: ["railway", "login"],
    },
  ];
}
