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
  /** "goal" wraps the icon in a tinted rounded badge; "job" renders it bare */
  variant?: "goal" | "job";
  className?: string;
}

export function NodeIcon({
  icon,
  defaultIcon = "flag",
  variant,
  className,
}: NodeIconProps) {
  const cls = cn(
    "size-3.5 shrink-0",
    variant === "goal" ? "text-sidebar-primary" : "text-muted-foreground",
    className,
  );

  let IconEl: React.ReactElement;
  if (icon) {
    const IconComponent = ICON_MAP[icon];
    if (IconComponent) {
      IconEl = <IconComponent className={cls} />;
    } else {
      IconEl = defaultIcon === "briefcase" ? <Briefcase className={cls} /> : <Flag className={cls} />;
    }
  } else {
    IconEl = defaultIcon === "briefcase" ? <Briefcase className={cls} /> : <Flag className={cls} />;
  }

  if (variant === "goal") {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded bg-sidebar-primary/15">
        {IconEl}
      </span>
    );
  }

  return IconEl;
}
