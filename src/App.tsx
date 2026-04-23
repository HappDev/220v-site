import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import PaySuccess from "./pages/PaySuccess";
import PayFail from "./pages/PayFail";
import Support from "./pages/Support";
import Policy from "./pages/Policy";
import Price from "./pages/Price";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";
import RequireVpnAuth from "./components/RequireVpnAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/price" element={<Price />} />
          <Route path="/terms" element={<Terms />} />
          <Route
            path="/support"
            element={
              <RequireVpnAuth>
                <Support />
              </RequireVpnAuth>
            }
          />
          <Route
            path="/support2"
            element={
              <RequireVpnAuth>
                <Support />
              </RequireVpnAuth>
            }
          />
          <Route path="/pay/success" element={<PaySuccess />} />
          <Route path="/pay/fail" element={<PayFail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
