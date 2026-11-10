import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

const DemoApp = lazy(() => import("@/demo/app"));
const PrototypeApp = lazy(() => import("@/prototype-app"));

// Keep the full prototype available while the portfolio entry loads independently.
export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ padding: "48px", color: "#42516b", fontFamily: "system-ui" }}>Loading SiteLens…</div>}>
        <Routes>
          <Route index element={<DemoApp />} />
          <Route path="demo" element={<DemoApp />} />
          <Route path="*" element={<PrototypeApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
