import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NodeIcon } from "@/components/shared/node-icon";
import { ICON_NAMES } from "@/lib/icon-map";
import { cn } from "@/lib/utils";

interface EmojiPickerProps {
  /** Current icon name from ICON_MAP (null = default icon) */
  value: string | null;
  /** Called when user selects an icon */
  onChange: (icon: string) => void;
  /** "goal" shows Flag default, "job" shows Briefcase default */
  variant: "goal" | "job";
  /** Optional: trigger AI regeneration */
  onRegenerate?: () => void;
  /** Whether AI regeneration is in progress */
  regenerating?: boolean;
  /** Extra classes for the trigger button */
  className?: string;
}

export function EmojiPicker({
  value,
  onChange,
  variant,
  onRegenerate,
  regenerating,
  className,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex size-9 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-accent",
            className,
          )}
          title="Change icon"
        >
          <NodeIcon
            icon={value}
            defaultIcon={variant === "goal" ? "flag" : "briefcase"}
            className="size-4"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="mb-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Sparkles className={cn("size-3.5", regenerating && "animate-spin")} />
            {regenerating ? "Picking icon..." : "Let AI pick"}
          </button>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleSelect(name)}
              title={name.replace(/_/g, " ")}
              className={cn(
                "flex size-8 items-center justify-center rounded transition-colors hover:bg-accent",
                value === name && "bg-accent ring-1 ring-primary",
              )}
            >
              <NodeIcon icon={name} className="size-4" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
