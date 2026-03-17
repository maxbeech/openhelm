import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import type { ClaudeCodeDetectionResult } from "@openorchestra/shared";

export function ClaudeCodeSection() {
  const [detection, setDetection] = useState<ClaudeCodeDetectionResult | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [showChange, setShowChange] = useState(false);
  const [customPath, setCustomPath] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    api
      .getClaudeCodeStatus()
      .then(setDetection)
      .finally(() => setLoading(false));
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
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4" />
            Not detected
          </div>
          <p className="text-xs text-muted-foreground">
            Install with:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              npm install -g @anthropic-ai/claude-code
            </code>
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowChange(true)}
          >
            Set path manually
          </Button>
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
          <Button
            variant="outline"
            size="sm"
            onClick={verifyPath}
            disabled={!customPath || verifying}
          >
            {verifying ? "..." : "Verify"}
          </Button>
        </div>
      )}
    </div>
  );
}
