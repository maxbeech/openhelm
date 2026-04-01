/**
 * node-icon.tsx — Renders a mono outline Lucide icon for a goal or job.
 * Looks up the icon name in ICON_MAP; falls back to a default if not found.
 */

import { Flag, Briefcase } from "lucide-react";
import { ICON_MAP } from "@/lib/icon-map";
import { cn } from "@/lib/utils";

interface NodeIconProps {
  /** Icon name key from ICON_MAP (e.g. "code", "database") */
  icon?: string | null;
  /** Default icon to show when icon is null/unknown */
  defaultIcon?: "flag" | "briefcase";
  className?: string;
}

export function NodeIcon({
  icon,
  defaultIcon = "flag",
  className,
}: NodeIconProps) {
  const cls = cn("size-3.5 shrink-0 text-muted-foreground", className);

  if (icon) {
    const IconComponent = ICON_MAP[icon];
    if (IconComponent) {
      return <IconComponent className={cls} />;
    }
  }

  return defaultIcon === "briefcase" ? (
    <Briefcase className={cls} />
  ) : (
    <Flag className={cls} />
  );
}
