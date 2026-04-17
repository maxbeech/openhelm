import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Brand icon for a service in the connection catalogue.
 * Loads an SVG URL from `src/assets/brand-icons/<slug>.svg` (vendored via
 * `scripts/fetch-brand-icons.mjs`); falls back to a generic globe when
 * the slug hasn't been vendored.
 */

// Vite glob import — resolves at build time into a map of slug → asset URL.
// Using ?url (not ?raw) avoids inlining SVG markup into the DOM.
const ICON_URL_MODULES = import.meta.glob<string>(
  "/src/assets/brand-icons/*.svg",
  { query: "?url", import: "default", eager: true },
);

const ICON_URL_BY_SLUG = new Map<string, string>();
for (const [path, url] of Object.entries(ICON_URL_MODULES)) {
  const match = path.match(/\/([^/]+)\.svg$/);
  if (match) ICON_URL_BY_SLUG.set(match[1], url);
}

interface Props {
  slug?: string;
  size?: number;
  className?: string;
}

export function BrandIcon({ slug, size = 16, className }: Props) {
  const url = slug ? ICON_URL_BY_SLUG.get(slug) : undefined;
  if (!url) {
    return (
      <Globe
        className={cn("text-muted-foreground", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={cn("inline-block opacity-90 [filter:invert(0.95)_brightness(1.2)]", className)}
      style={{ width: size, height: size }}
    />
  );
}
