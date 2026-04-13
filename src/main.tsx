import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./router";
import { AuthGuard } from "./components/auth/auth-guard";
import { installDemoErrorHandler } from "./lib/demo-errors";
import "./styles/globals.css";

// Surface DemoReadOnlyError rejections as the signup modal instead of the
// generic error toast. Must run before any transport.request() calls.
installDemoErrorHandler();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGuard>
      <AppRouter />
    </AuthGuard>
  </React.StrictMode>,
);
