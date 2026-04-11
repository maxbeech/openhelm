import { Separator } from "@/components/ui/separator";
import { LicenseSection } from "./license-section";
import { ClaudeCodeSection } from "./claude-code-section";
import { ExecutionSection } from "./execution-section";
import { AutopilotSection } from "./autopilot-section";
import { ApplicationSection } from "./application-section";
import { PermissionsSection } from "./permissions-section";
import { DataSection } from "./data-section";
import { isCloudMode } from "@/lib/mode";
import { UsageDashboard } from "@/components/cloud/usage-dashboard";
import { PlanManager } from "@/components/cloud/plan-manager";

export function SettingsScreen() {
  if (isCloudMode) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h2 className="mb-6 text-xl font-semibold">Settings</h2>
        <div className="space-y-8">
          <PlanManager />
          <Separator />
          <UsageDashboard />
          <Separator />
          <AutopilotSection />
          <Separator />
          <ExecutionSection />
          <Separator />
          <ApplicationSection />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-6 text-xl font-semibold">Settings</h2>
      <div className="space-y-8">
        <LicenseSection />
        <Separator />
        <ClaudeCodeSection />
        <Separator />
        <ExecutionSection />
        <Separator />
        <AutopilotSection />
        <Separator />
        <ApplicationSection />
        <Separator />
        <PermissionsSection />
        <Separator />
        <DataSection />
      </div>
    </div>
  );
}
