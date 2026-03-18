import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";

export function CompleteStep({ onComplete }: { onComplete: (autoUpdate: boolean) => void }) {
  const [autoUpdate, setAutoUpdate] = useState(true);

  return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-full bg-success/20 p-3">
        <CheckCircle2 className="size-10 text-success" />
      </div>
      <h2 className="mt-4 text-2xl font-semibold">You're all set.</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Everything is configured. Create your first goal to get started.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Checkbox
          id="auto-update"
          checked={autoUpdate}
          onCheckedChange={(v) => setAutoUpdate(Boolean(v))}
        />
        <Label htmlFor="auto-update" className="text-sm font-normal cursor-pointer">
          Automatically install updates when available
        </Label>
      </div>
      <Button onClick={() => onComplete(autoUpdate)} size="lg" className="mt-6">
        Create your first goal
      </Button>
    </div>
  );
}
