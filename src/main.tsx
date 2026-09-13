import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";
import "./types/global.d.ts";
import { initPwa } from "@/lib/pwa";
import { initTheme } from "@/lib/jarvis/theme";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Native builds (Android APK / Windows exe) run fully local: no cloud auth,
// no Convex dependency. The console itself never uses the cloud backend —
// only the optional template account does.
const IS_NATIVE =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

const convex = new ConvexReactClient(
  ((import.meta.env.VITE_CONVEX_URL as string | undefined) ??
    // CI-built native apps have no .env — a placeholder keeps the client
    // constructible (history sync just stays offline instead of crashing).
    (IS_NATIVE ? "https://convex.placeholder.invalid" : undefined)) as string,
);



/** Signed-in users launch straight into the console — the landing page is for signed-out visitors. */
function LandingGate() {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) return <RouteLoading />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


initPwa();
initTheme(); // accent color + perf-lite before first paint

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VlyToolbar />
    <InstrumentationProvider>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={IS_NATIVE ? <Navigate to="/dashboard" replace /> : <LandingGate />} />
              <Route
                path="/auth"
                element={
                  IS_NATIVE ? (
                    // No cloud sign-in in the local apps — straight in.
                    <Navigate to="/dashboard" replace />
                  ) : (
                    <AuthPage redirectAfterAuth="/dashboard" />
                  )
                }
              />
              <Route
                path="/dashboard"
                element={
                  IS_NATIVE ? (
                    <Dashboard />
                  ) : (
                    <RequireAuth>
                      <Dashboard />
                    </RequireAuth>
                  )
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </InstrumentationProvider>
  </StrictMode>,
);
