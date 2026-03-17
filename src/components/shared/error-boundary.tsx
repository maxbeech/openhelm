import { ErrorBoundary as SentryErrorBoundary } from "@sentry/react";
import { Button } from "@/components/ui/button";

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <SentryErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <p className="font-medium text-destructive">Something went wrong</p>
          <p className="text-xs text-muted-foreground">
            {(error as Error)?.message}
          </p>
          <Button onClick={resetError} variant="outline" size="sm">
            Try again
          </Button>
        </div>
      )}
    >
      {children}
    </SentryErrorBoundary>
  );
}
