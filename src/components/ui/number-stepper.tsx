import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NumberStepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
  "aria-label"?: string;
}

export function NumberStepper({
  value,
  onChange,
  min,
  max,
  className,
  "aria-label": ariaLabel,
}: NumberStepperProps) {
  const decrement = () => {
    const next = value - 1;
    if (min === undefined || next >= min) onChange(next);
  };

  const increment = () => {
    const next = value + 1;
    if (max === undefined || next <= max) onChange(next);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (isNaN(parsed)) return;
    if (min !== undefined && parsed < min) return;
    if (max !== undefined && parsed > max) return;
    onChange(parsed);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        onClick={decrement}
        disabled={min !== undefined && value <= min}
        aria-label={`Decrease${ariaLabel ? " " + ariaLabel : ""}`}
      >
        <Minus className="size-3.5" />
      </Button>
      <Input
        type="number"
        value={value}
        onChange={handleInput}
        min={min}
        max={max}
        className="h-9 w-16 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label={ariaLabel}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        onClick={increment}
        disabled={max !== undefined && value >= max}
        aria-label={`Increase${ariaLabel ? " " + ariaLabel : ""}`}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
