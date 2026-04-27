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
import Chat from "./pages/Chat";
import Policy from "./pages/Policy";
import Price from "./pages/Price";
import Tariff from "./pages/Tariff";
import TariffPay from "./pages/TariffPay";
import Traffic from "./pages/Traffic";
import TrafficPay from "./pages/TrafficPay";
import Instructions from "./pages/Instructions";
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
          <Route
            path="/tariff"
            element={
              <RequireVpnAuth>
                <Tariff />
              </RequireVpnAuth>
            }
          />
          <Route
            path="/tariff/pay"
            element={
              <RequireVpnAuth>
                <TariffPay />
              </RequireVpnAuth>
            }
          />
          <Route
            path="/traffic"
            element={
              <RequireVpnAuth>
                <Traffic />
              </RequireVpnAuth>
            }
          />
          <Route
            path="/traffic/pay"
            element={
              <RequireVpnAuth>
                <TrafficPay />
              </RequireVpnAuth>
            }
          />
          <Route
            path="/instructions"
            element={
              <RequireVpnAuth>
                <Instructions />
              </RequireVpnAuth>
            }
          />
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
            path="/chat"
            element={
              <RequireVpnAuth>
                <Chat />
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
