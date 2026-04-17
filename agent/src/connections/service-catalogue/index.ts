import type { ServiceCatalogueEntry } from "@openhelm/shared";
import { DEV_AND_INFRA_SERVICES } from "./dev-and-infra.js";
import { PRODUCTIVITY_AND_COMMS_SERVICES } from "./productivity-and-comms.js";

/**
 * Bundled catalogue of services users can search for when creating a connection.
 * Intentionally curated (not exhaustive): covers the services that most users
 * will reach for. MCP registry results are merged on top at query time for
 * anything we haven't curated here.
 */
export const SERVICE_CATALOGUE: ServiceCatalogueEntry[] = [
  ...DEV_AND_INFRA_SERVICES,
  ...PRODUCTIVITY_AND_COMMS_SERVICES,
];

const BY_ID = new Map(SERVICE_CATALOGUE.map((e) => [e.id, e] as const));

export function getCatalogueEntry(id: string): ServiceCatalogueEntry | undefined {
  return BY_ID.get(id);
}

/** All unique `iconSlug` values referenced by the catalogue (falls back to id). */
export function getAllIconSlugs(): string[] {
  const slugs = new Set<string>();
  for (const e of SERVICE_CATALOGUE) slugs.add(e.iconSlug ?? e.id);
  return [...slugs];
}
