/**
 * Top-level router for OpenHelm.
 *
 * Strategy: minimal BrowserRouter wrap that routes `/demo/:slug/*` to the
 * public demo experience and delegates every other path to the existing
 * Zustand-driven <App>. This keeps the massive existing ContentView-based
 * navigation intact while enabling URL-scoped demo entry points.
 *
 * Progressive migration to per-view routes (e.g. /goal/:id, /job/:id) can
 * happen in follow-up PRs without touching this file's structure.
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
