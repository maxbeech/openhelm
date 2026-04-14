/**
 * Top-level router for OpenHelm.
 *
 * Strategy: minimal BrowserRouter wrap that routes `/demo/:slug/*` to the
 * public demo experience and delegates every other path to <App>.
 *
 * In-app pages (/inbox, /dashboard, /goals/:id, /jobs/:id, /data/:id, …)
 * are not enumerated here as individual <Route>s. Instead, `useUrlSync`
 * in `src/hooks/use-url-sync.ts` keeps the URL and the Zustand-driven
 * `contentView`/selection state in sync on top of this single catch-all.
 * This preserves the existing ContentView render tree + slide animations
 * while giving every page a real URL for back/forward, refresh, and deep
 * links.
 */

import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";

const DemoRoute = lazy(() =>
  import("./routes/demo-route").then((m) => ({ default: m.DemoRoute })),
);

function DemoLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Loading demo…</div>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/demo/:slug/*"
          element={
            <Suspense fallback={<DemoLoading />}>
              <DemoRoute />
            </Suspense>
          }
        />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}
