import { Separator } from "@/components/ui/separator";
import { ClaudeCodeSection } from "./claude-code-section";
import { ExecutionSection } from "./execution-section";
import { ApplicationSection } from "./application-section";

export function SettingsScreen() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-6 text-xl font-semibold">Settings</h2>
      <div className="space-y-8">
        <ClaudeCodeSection />
        <Separator />
        <ExecutionSection />
        <Separator />
        <ApplicationSection />
      </div>
    </div>
  );
}
