import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import * as api from "@/lib/api";
import type { ClaudeCodeDetectionResult } from "@openorchestra/shared";

export function SettingsScreen() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-6 text-xl font-semibold">Settings</h2>
      <div className="space-y-8">
        <ClaudeCodeSection />
        <Separator />
        <ApiKeySection />
        <Separator />
        <ExecutionSection />
        <Separator />
        <ApplicationSection />
      </div>
    </div>
  );
}

function ClaudeCodeSection() {
  const [detection, setDetection] = useState<ClaudeCodeDetectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChange, setShowChange] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    api.getClaudeCodeStatus().then(setDetection).finally(() => setLoading(false));
  }, []);

  const verifyPath = async () => {
    setVerifying(true);
    try {
      const r = await api.verifyClaudeCode({ path: customPath });
      setDetection(r);
      if (r.found) setShowChange(false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Claude Code</h3>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading...
        </div>
      ) : detection?.found ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" />
            Detected
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Path: {detection.path}</p>
            <p>Version: {detection.version}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowChange(!showChange)}
          >
            Change path
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="size-4" />
          Not detected
        </div>
      )}
      {showChange && (
        <div className="mt-2 flex gap-2">
          <Input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/path/to/claude"
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={verifyPath} disabled={!customPath || verifying}>
            {verifying ? "..." : "Verify"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ApiKeySection() {
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSetting("anthropic_api_key").then((s) => {
      if (s?.value) {
        setMaskedKey("****" + s.value.slice(-4));
      }
    });
  }, []);

  const saveKey = async () => {
    setSaving(true);
    try {
      await api.setSetting({ key: "anthropic_api_key", value: newKey });
      setMaskedKey("****" + newKey.slice(-4));
      setShowChange(false);
      setNewKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Anthropic API</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Used for goal planning and run summarisation. Separate from your Claude
        Code subscription.
      </p>
      {maskedKey && (
        <p className="mb-2 text-sm">
          Key: <code className="font-mono text-muted-foreground">{maskedKey}</code>
        </p>
      )}
      {saved && (
        <p className="mb-2 text-sm text-success">Key updated successfully</p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowChange(!showChange)}
      >
        {maskedKey ? "Change key" : "Add key"}
      </Button>
      {showChange && (
        <div className="mt-2 flex gap-2">
          <Input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="sk-ant-..."
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={saveKey} disabled={!newKey || saving}>
            {saving ? "..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ExecutionSection() {
  const [maxConcurrent, setMaxConcurrent] = useState("1");
  const [timeout, setTimeout_] = useState("30");

  useEffect(() => {
    Promise.all([
      api.getSetting("max_concurrent_runs"),
      api.getSetting("run_timeout_minutes"),
    ]).then(([concurrent, to]) => {
      if (concurrent?.value) setMaxConcurrent(concurrent.value);
      if (to?.value) setTimeout_(to.value);
    });
  }, []);

  const saveSetting = async (key: "max_concurrent_runs" | "run_timeout_minutes", value: string) => {
    await api.setSetting({ key, value });
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Execution</h3>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm">Max concurrent runs</Label>
          <Select
            value={maxConcurrent}
            onValueChange={(v) => {
              setMaxConcurrent(v);
              saveSetting("max_concurrent_runs", v);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Recommended: 1 for most use cases.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Default run timeout</Label>
          <Select
            value={timeout}
            onValueChange={(v) => {
              setTimeout_(v);
              saveSetting("run_timeout_minutes", v);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 minutes</SelectItem>
              <SelectItem value="20">20 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">60 minutes</SelectItem>
              <SelectItem value="120">120 minutes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function ApplicationSection() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(true);

  useEffect(() => {
    invoke<boolean>("plugin:autostart|is_enabled")
      .then(setLaunchAtLogin)
      .catch(() => setLaunchAtLogin(false))
      .finally(() => setLaunchLoading(false));
  }, []);

  const toggleLaunchAtLogin = async (enabled: boolean) => {
    try {
      if (enabled) {
        await invoke("plugin:autostart|enable");
      } else {
        await invoke("plugin:autostart|disable");
      }
      setLaunchAtLogin(enabled);
    } catch (err) {
      console.error("Failed to toggle launch at login:", err);
    }
  };

  return (
    <div>
      <h3 className="mb-3 font-medium">Application</h3>
      <div className="space-y-4 text-sm text-muted-foreground">
        <p>Version: 0.1.0</p>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-foreground">Launch at login</Label>
            <p className="text-xs text-muted-foreground">
              Start OpenOrchestra automatically when you log in.
            </p>
          </div>
          <Switch
            checked={launchAtLogin}
            onCheckedChange={toggleLaunchAtLogin}
            disabled={launchLoading}
          />
        </div>
        <div className="flex gap-4">
          <a
            href="https://openorchestra.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            OpenOrchestra.ai <ExternalLink className="size-3" />
          </a>
          <a
            href="https://github.com/openorchestra/openorchestra"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            GitHub <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
