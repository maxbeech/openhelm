import { Input } from "@/components/ui/input";
import { Search, Code, FileText } from "lucide-react";
import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RunLog } from "@openorchestra/shared";
import { cn } from "@/lib/utils";
import { LogViewerRaw } from "./log-viewer-raw";

type DisplayMode = "raw" | "rendered";

interface LogViewerProps {
  logs: RunLog[];
  loading: boolean;
  isLive: boolean;
}

export function LogViewer({ logs, loading, isLive }: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    isLive ? "raw" : "rendered",
  );

  const lineCount = useMemo(() => {
    let count = 0;
    for (const log of logs) {
      count += log.text.split("\n").length;
    }
    return count;
  }, [logs]);

  const fullText = useMemo(
    () => logs.map((l) => l.text).join("\n"),
    [logs],
  );

  return (
    <div className="relative flex h-full flex-col">
      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="h-7 border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
            autoFocus
          />
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          {loading ? "Loading..." : `${lineCount} line${lineCount !== 1 ? "s" : ""}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDisplayMode(displayMode === "raw" ? "rendered" : "raw")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
              "text-muted-foreground hover:text-foreground",
            )}
            title={displayMode === "raw" ? "Switch to rendered" : "Switch to raw"}
          >
            {displayMode === "raw" ? (
              <><FileText className="size-3" /> Rendered</>
            ) : (
              <><Code className="size-3" /> Raw</>
            )}
          </button>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Search className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {displayMode === "raw" ? (
        <LogViewerRaw
          logs={logs}
          loading={loading}
          isLive={isLive}
          searchQuery={searchQuery}
        />
      ) : (
        <div className="flex-1 overflow-auto bg-background p-4">
          {logs.length === 0 && !loading ? (
            <p className="py-8 text-center text-muted-foreground">No log output</p>
          ) : (
            <div className="markdown-content break-words text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullText}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
