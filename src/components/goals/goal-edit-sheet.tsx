import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { useGoalStore } from "@/stores/goal-store";
import { CredentialMultiPicker } from "@/components/credentials/credential-multi-picker";
import { setCredentialScopesForEntity } from "@/lib/api";
import type { Goal } from "@openhelm/shared";

interface GoalEditSheetProps {
  goal: Goal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function GoalEditSheet({
  goal,
  open,
  onOpenChange,
  onComplete,
}: GoalEditSheetProps) {
  const { updateGoal } = useGoalStore();

  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description ?? "");
  const [icon, setIcon] = useState<string | null>(goal.icon);
  const [credentialIds, setCredentialIds] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(goal.name);
      setDescription(goal.description ?? "");
      setIcon(goal.icon);
      // Reset credentials so the CredentialMultiPicker re-loads for this goal's scope.
      setCredentialIds([]);
      setNameTouched(false);
      setError(null);
      setSaving(false);
    }
  }, [open, goal]);

  const isValid = name.trim().length > 0;

  const handleSubmit = async () => {
    setNameTouched(true);
    if (!isValid) return;

    setSaving(true);
    setError(null);
    try {
      await updateGoal({
        id: goal.id,
        name: name.trim(),
        description: description.trim() || undefined,
        ...(icon !== goal.icon && { icon: icon ?? undefined }),
      });
      await setCredentialScopesForEntity({ scopeType: "goal", scopeId: goal.id, credentialIds });
      onOpenChange(false);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Edit Goal</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-edit-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              <EmojiPicker
                value={icon}
                onChange={setIcon}
                variant="goal"
              />
              <Input
                id="goal-edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="e.g. Improve test coverage"
                className="h-9 flex-1"
                autoFocus
              />
            </div>
            {nameTouched && !name.trim() && (
              <p className="text-xs text-destructive">Name is required</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Credentials (optional)</Label>
            <CredentialMultiPicker
              value={credentialIds}
              onChange={setCredentialIds}
              existingScope={{ scopeType: "goal", scopeId: goal.id }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-edit-description">Description (optional)</Label>
            <Textarea
              id="goal-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context about what you want to achieve..."
              rows={3}
              className="text-sm"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSubmit}
            disabled={saving || !isValid}
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
